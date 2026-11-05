import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import {
  checkGameChannelJoin,
  purgeGameMessages,
  requireGroup,
  sendGameMessage,
} from './utils.js';
import {
  MAX_MS_PLAYERS,
  MIN_MS_PLAYERS,
  MS_BOARD,
  MS_CELL_HIDDEN,
  MS_EMOJI,
  MS_MARK,
  MS_NAME_FA,
  MsCell,
  MsDifficulty,
  MsStanding,
  colourForSeat,
  computeMsAdjacent,
  createMsBoard,
  minesFoundBySeat,
  msBoardState,
  msCellLabel,
  msNeighbourMines,
  openAroundFound,
  placeMsMines,
  rankMsStandings,
  revealUnfoundMines,
  safeOpenedBySeat,
  tapMsCell,
} from './minesweeper-logic.js';

// ─── Types ───────────────────────────────────
interface MsPlayer {
  id: number;
  name: string;
  /** صندلی بازیکن = رنگش (۰ = 🔴، ۱ = 🔵، ۲ = 🟢 …) */
  seat: number;
}

interface MsOutcome {
  winnerSeat: number | null;
  draw: boolean;
  reason: string;
}

interface MsSession {
  chatId: number;
  messageId: number;
  starterId: number;
  difficulty: MsDifficulty;
  board: MsCell[][];
  players: MsPlayer[];
  currentSeat: number;
  status: 'waiting' | 'playing' | 'finished';
  minesPlaced: boolean;
  outcome: MsOutcome | null;
  createdAt: number;
}

/** شرکت همه بازیکنان + امتیاز هر مین + جایزهٔ سطح برای برنده */
const PARTICIPATION_POINTS = 10;
const MINE_POINTS = 3;
const SESSION_TTL_MS = 30 * 60_000;

/**
 * دستور مالک: پیام‌های مین‌روب (تخته + اعلام برنده) ۲۰ ثانیه بعد از پایان یا
 * لغو بازی از گروه پاک شوند تا گروه شلوغ نشود. مخصوص همین بازی است؛ بقیهٔ
 * بازی‌ها از مقدار پیش‌فرض utils.js استفاده می‌کنند.
 */
const MS_PURGE_DELAY_MS = 20_000;

const sessions = new Map<string, MsSession>();

function sessionKey(chatId: number): string {
  return `ms:${chatId}`;
}

// ─── Helpers ─────────────────────────────────
function currentPlayer(session: MsSession): MsPlayer | null {
  if (session.players.length === 0) return null;
  return session.players[session.currentSeat % session.players.length];
}

function advanceTurn(session: MsSession): void {
  if (session.players.length === 0) return;
  session.currentSeat = (session.currentSeat + 1) % session.players.length;
}

function seatOf(session: MsSession, userId: number): number {
  return session.players.findIndex((p) => p.id === userId);
}

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

function faNum(value: number): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

function safeName(name: string): string {
  return name.replace(/[[\]*_~`>]/g, '').trim() || 'بازیکن';
}

function mentionUser(player: MsPlayer): string {
  return `[${safeName(player.name)}](tg://user?id=${player.id})`;
}

function colourBadge(player: MsPlayer): string {
  return MS_EMOJI[colourForSeat(player.seat)];
}

function sizeLabel(difficulty: MsDifficulty): string {
  return `${faNum(difficulty.rows)}×${faNum(difficulty.cols)} با ${faNum(difficulty.mines)} مین`;
}

// ─── Keyboard ────────────────────────────────
/** رنگ دکمه‌ها مثل مین‌روب کلاسیک: خانه‌های کم‌مین آبی، میانی سبز، پرجمعیت قرمز */
function msButtonStyle(cell: MsCell): 'danger' | 'success' | 'primary' | undefined {
  if (!cell.revealed) return undefined;
  if (cell.isMine) return 'danger';
  if (cell.adjacent === 0) return undefined;
  if (cell.adjacent <= 2) return 'primary';
  if (cell.adjacent <= 4) return 'success';
  return 'danger';
}

function buildMsKeyboard(session: MsSession): any {
  const { rows, cols } = session.difficulty;
  const keyboard: any[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: any[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = session.board[r][c];
      // خانهٔ باز‌شده = تلاش برای باز کردن اطرافش، خانهٔ پوشیده = ضربهٔ معمولی
      const action = cell.revealed ? `ms_open_${r}_${c}` : `ms_tap_${r}_${c}`;
      const btn: any = Markup.button.callback(msCellLabel(cell), action);
      const style = msButtonStyle(cell);
      if (style) btn.style = style;
      row.push(btn);
    }
    keyboard.push(row);
  }

  if (session.status === 'waiting') {
    // دوئل دو نفره است: با پر شدن دو صندلی، دکمهٔ پیوستن هم دیگر نمی‌ماند
    if (session.players.length < MAX_MS_PLAYERS) {
      const colour = colourForSeat(session.players.length);
      keyboard.push([
        Markup.button.callback(
          `🎮 پیوستن به بازی — ${MS_EMOJI[colour]} ${MS_NAME_FA[colour]}`,
          'ms_join'
        ),
      ]);
    }
    keyboard.push([
      Markup.button.callback('▶️ شروع بازی', 'ms_start'),
      Markup.button.callback('ℹ️ راهنما', 'ms_help'),
    ]);
    keyboard.push([Markup.button.callback('❌ لغو بازی', 'ms_cancel')]);
    return Markup.inlineKeyboard(keyboard);
  }

  if (session.status === 'finished') {
    keyboard.push([
      Markup.button.callback('🔄 بازی جدید', 'ms_new'),
      Markup.button.callback('🎮 منوی بازی', 'games'),
    ]);
    return Markup.inlineKeyboard(keyboard);
  }

  keyboard.push([
    Markup.button.callback('ℹ️ راهنما', 'ms_help'),
    Markup.button.callback('❌ لغو بازی', 'ms_cancel'),
  ]);
  return Markup.inlineKeyboard(keyboard);
}

// ─── Message text ────────────────────────────
function playerLine(session: MsSession, player: MsPlayer): string {
  const badge = colourBadge(player);
  if (session.status === 'waiting') {
    return `${badge} ${mentionUser(player)}`;
  }
  // دستور مالک: روی تخته فقط تعداد مین پیدا‌شدهٔ هر نفر دیده می‌شود؛
  // خانه‌های امن فقط برای مساوی‌شکنی پنهانی حساب می‌شوند.
  const mines = minesFoundBySeat(session.board, player.seat);
  return `${badge} ${mentionUser(player)} — ${faNum(mines)} مین`;
}

function playersBlock(session: MsSession): string {
  return session.players.map((p) => playerLine(session, p)).join('\n');
}

function buildMsText(session: MsSession): string {
  const { label, mines } = session.difficulty;

  const state = msBoardState(session.board, session.difficulty.rows, session.difficulty.cols, mines);
  const lines: string[] = [];

  lines.push(`💣 *مین‌روب — ${label}* (${sizeLabel(session.difficulty)})`);

  if (session.status === 'waiting') {
    lines.push('');
    lines.push('👥 *دوئل دو نفره:* 🔴 قرمز در برابر 🔵 آبی');
    lines.push(`بازیکنان (${faNum(session.players.length)} از ${faNum(MAX_MS_PLAYERS)}):`);
    lines.push(playersBlock(session) || '—');
    lines.push('');
    if (session.players.length < MIN_MS_PLAYERS) {
      const colour = colourForSeat(session.players.length);
      lines.push(
        `⏳ منتظر بازیکن دوم… نفر بعدی ${MS_EMOJI[colour]} ${MS_NAME_FA[colour]} می‌شود؛ دکمهٔ «🎮 پیوستن به بازی» را بزند.`
      );
    } else {
      lines.push('✅ هر دو بازیکن آماده‌اند؛ *هر کدام از شما* که دکمهٔ «▶️ شروع بازی» را بزند بازی شروع می‌شود.');
    }
    lines.push('');
    lines.push('📌 *قانون:*');
    lines.push('• بازی *نوبتی* است؛ بازیکن اول 🔴 قرمز نوبت اول را دارد');
    lines.push('• روی *مین* بزنی: خانه با رنگ تو علامت می‌خورد، ۱ امتیاز می‌گیری و *نوبت هم پیش تو می‌ماند*');
    lines.push('• روی *خانهٔ امن* بزنی: عددِ مین‌های اطرافش باز می‌شود (خانهٔ صفر کل ناحیه را باز می‌کند) و نوبت به نفر بعد می‌رود');
    lines.push('• اگر روی خانهٔ عدددار بزنی و همهٔ مین‌های اطرافش علامت خورده باشند، بقیهٔ خانه‌های اطراف یک‌جا باز می‌شوند');
    lines.push(`• خانهٔ علامت‌خورده با ${MS_MARK.red} ${MS_MARK.blue} یعنی مینش را آن بازیکن پیدا کرده`);
    lines.push('• *عدد همهٔ مین‌های اطراف را می‌شمارد*؛ مینی که هنوز پیدا نشده زیر ◽ پنهان است، پس عدد می‌تواند از مین‌های دیدنی بیشتر باشد');
    lines.push('• برای اطمینان، روی همان خانهٔ عدددار بزن: می‌گویند چند مینش پیدا شده و چندتا هنوز پنهان است');
    lines.push('• جان و جریمه‌ای وجود ندارد؛ *هرکس مین بیشتری پیدا کند برنده است*');
    lines.push('• بازی وقتی تمام می‌شود که همهٔ مین‌ها پیدا شوند یا فقط مین‌ها پنهان بمانند');
    lines.push('');
    lines.push('🔒 مین‌ها بعد از زدن دکمهٔ شروع چیده می‌شوند، پس هیچ‌کس از قبل جای آن‌ها را نمی‌داند.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push(
    `🚩 مین پیدا‌شده: ${faNum(state.minesFound)} از ${faNum(mines)} | ` +
      `${MS_CELL_HIDDEN} خانهٔ باز‌نشده: ${faNum(state.hiddenLeft)}`
  );
  lines.push('');
  lines.push('👥 *بازیکنان:*');
  lines.push(playersBlock(session) || '—');

  if (session.status === 'finished') {
    // برنده و نتیجه در پیام *جداگانه* اعلام می‌شوند (درخواست مالک)؛
    // پیام تخته فقط تختهٔ آخر را نگه می‌دارد تا شلوغ نشود.
    lines.push('');
    lines.push('🏁 بازی تمام شد — *برنده و نتیجه در پیام جداگانه* نوشته شد.');
    lines.push(`🧹 تا ${faNum(MS_PURGE_DELAY_MS / 1000)} ثانیه دیگر همهٔ پیام‌های این بازی از گروه پاک می‌شود.`);
    return lines.join('\n');
  }

  const turn = currentPlayer(session);
  lines.push('');
  lines.push(
    turn
      ? `🎯 نوبت: ${colourBadge(turn)} ${mentionUser(turn)} — یک خانه انتخاب کن.`
      : '🎯 نوبت: —'
  );
  return lines.join('\n');
}

function standingsOf(session: MsSession): MsStanding[] {
  return session.players.map((p) => ({
    seat: p.seat,
    mines: minesFoundBySeat(session.board, p.seat),
    opened: safeOpenedBySeat(session.board, p.seat),
  }));
}

// ─── Start Minesweeper ───────────────────────
export async function handleMinesweeper(ctx: Context) {
  if (!(await requireGroup(ctx, 'مین‌روب'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < SESSION_TTL_MS) {
    await ctx.reply(
      '⏳ یک بازی مین‌روب در این گروه در حال انجام است. صبر کنید تمام شود یا با دکمهٔ «❌ لغو بازی» آن را ببندید.'
    );
    return;
  }

  // بدون مرحلهٔ انتخاب سطح: بازی مستقیم روی تختهٔ سخت (۹×۹ با ۲۱ مین) ساخته می‌شود
  const difficulty = MS_BOARD;
  const session: MsSession = {
    chatId,
    messageId: 0,
    starterId: ctx.from!.id,
    difficulty,
    board: createMsBoard(difficulty.rows, difficulty.cols),
    players: [{ id: ctx.from!.id, name: ctx.from!.first_name || 'بازیکن', seat: 0 }],
    currentSeat: 0,
    status: 'waiting',
    minesPlaced: false,
    outcome: null,
    createdAt: Date.now(),
  };
  sessions.set(key, session);

  const messageId = await sendGameMessage(ctx, key, buildMsText(session), {
    parse_mode: 'Markdown',
    ...buildMsKeyboard(session),
  });
  if (typeof messageId === 'number') session.messageId = messageId;
}

// ─── Action Handler ──────────────────────────
export async function handleMinesweeperAction(ctx: Context) {
  const action = (ctx.callbackQuery as any).data as string;
  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);
  const session = sessions.get(key);

  if (!session) {
    await ctx.answerCbQuery('⏰ بازی منقضی شده یا وجود ندارد.');
    return;
  }

  const userId = ctx.from!.id;

  // ── پیوستن به بازی ──
  if (action === 'ms_join') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (seatOf(session, userId) >= 0) {
      await ctx.answerCbQuery('شما قبلاً پیوسته‌اید!');
      return;
    }
    if (session.players.length >= MAX_MS_PLAYERS) {
      await ctx.answerCbQuery(
        `❌ این بازی دو نفره است و هر دو صندلی (${MS_EMOJI.red} ${MS_NAME_FA.red} و ${MS_EMOJI.blue} ${MS_NAME_FA.blue}) پر شده.`
      );
      return;
    }

    const seat = session.players.length;
    session.players.push({ id: userId, name: ctx.from!.first_name || 'بازیکن', seat });
    const colour = colourForSeat(seat);

    await ctx.answerCbQuery(
      `🎮 پیوستی! رنگ شما ${MS_EMOJI[colour]} ${MS_NAME_FA[colour]} — هر دو بازیکن آماده‌اند، «▶️ شروع بازی» را بزنید.`
    );
    await updateMsMessage(ctx, session);
    return;
  }

  // ── شروع بازی ──
  if (action === 'ms_start') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    // هر بازیکنی (نه فقط شروع‌کننده) می‌تواند بازی را استارت بزند؛
    // ولی کسی که صندلی ندارد نمی‌تواند بازی دیگران را شروع کند.
    if (seatOf(session, userId) < 0) {
      await ctx.answerCbQuery('❌ اول با دکمهٔ «🎮 پیوستن به بازی» وارد بازی شوید، بعد شروعش کنید.');
      return;
    }
    if (session.players.length < MIN_MS_PLAYERS) {
      await ctx.answerCbQuery('❌ برای شروع بازی بازیکن دوم لازم است!');
      return;
    }

    placeMsMines(session.board, session.difficulty.rows, session.difficulty.cols, session.difficulty.mines);
    computeMsAdjacent(session.board, session.difficulty.rows, session.difficulty.cols);
    session.minesPlaced = true;
    session.status = 'playing';
    session.currentSeat = 0;

    const first = currentPlayer(session);
    await ctx.answerCbQuery(
      first
        ? `🎮 شروع! نوبت اول با ${MS_EMOJI[colourForSeat(first.seat)]} ${safeName(first.name)}.`
        : '🎮 شروع!'
    );
    await updateMsMessage(ctx, session);
    return;
  }

  // ── راهنما ──
  if (action === 'ms_help') {
    await ctx.answerCbQuery(
      'نوبتی: روی مین بزنی رنگ تو روی خانه می‌نشیند، ۱ امتیاز می‌گیری و نوبت پیش تو می‌ماند. ' +
        'روی خانهٔ امن بزنی عددش باز می‌شود و نوبت به نفر بعد می‌رود. بیشترین مین = برنده. ' +
        'عددِ هر خانه همهٔ مین‌های اطرافش را می‌شمارد، حتی آن‌هایی که هنوز زیر ◽ پنهان‌اند؛ ' +
        'با زدن روی همان خانهٔ عدددار می‌فهمی چندتا پیدا شده و چندتا مانده.',
      { show_alert: true }
    );
    return;
  }

  // ── لغو ──
  if (action === 'ms_cancel') {
    if (session.status === 'playing' && seatOf(session, userId) < 0) {
      await ctx.answerCbQuery('❌ شما بازیکن این بازی نیستید.');
      return;
    }
    sessions.delete(key);
    await ctx.answerCbQuery('بازی لغو شد.');
    try {
      await ctx.editMessageText(`❌ بازی مین‌روب لغو شد — تا ${faNum(MS_PURGE_DELAY_MS / 1000)} ثانیه دیگر پاک می‌شود.`);
    } catch {}
    void purgeGameMessages(ctx.telegram, key, MS_PURGE_DELAY_MS);
    return;
  }

  // ── بازی جدید ──
  if (action === 'ms_new') {
    const difficulty = session.difficulty;
    const fresh: MsSession = {
      chatId,
      messageId: 0,
      starterId: userId,
      difficulty,
      board: createMsBoard(difficulty.rows, difficulty.cols),
      players: [{ id: userId, name: ctx.from!.first_name || 'بازیکن', seat: 0 }],
      currentSeat: 0,
      status: 'waiting',
      minesPlaced: false,
      outcome: null,
      createdAt: Date.now(),
    };
    sessions.set(key, fresh);

    await ctx.answerCbQuery('🔄 بازی جدید — منتظر بازیکن دیگر.');
    const messageId = await sendGameMessage(ctx, key, buildMsText(fresh), {
      parse_mode: 'Markdown',
      ...buildMsKeyboard(fresh),
    });
    if (typeof messageId === 'number') fresh.messageId = messageId;
    return;
  }

  // ── ضربه روی خانه ──
  if (action.startsWith('ms_tap_') || action.startsWith('ms_open_')) {
    await handleMsCellTap(ctx, session, action);
    return;
  }
}

async function handleMsCellTap(ctx: Context, session: MsSession, action: string) {
  const userId = ctx.from!.id;

  if (session.status !== 'playing') {
    await ctx.answerCbQuery('⏳ بازی هنوز شروع نشده!');
    return;
  }

  const tapperSeat = seatOf(session, userId);
  if (tapperSeat < 0) {
    await ctx.answerCbQuery('❌ شما بازیکن این بازی نیستید؛ دکمهٔ «🎮 پیوستن به بازی» را بزنید.');
    return;
  }

  const turn = currentPlayer(session);
  if (!turn || tapperSeat !== turn.seat) {
    await ctx.answerCbQuery(
      turn ? `⏳ نوبت ${colourBadge(turn)} ${safeName(turn.name)} است!` : '⏳ نوبتی در کار نیست.'
    );
    return;
  }

  const parts = action.split('_');
  const row = Number(parts[2]);
  const col = Number(parts[3]);
  const { rows, cols, mines } = session.difficulty;

  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= rows || col < 0 || col >= cols) {
    await ctx.answerCbQuery('❌ خانهٔ نامعتبر!');
    return;
  }

  // دفاعی: اگر به هر دلیلی مین‌ها هنوز چیده نشده بودند
  if (!session.minesPlaced) {
    placeMsMines(session.board, rows, cols, mines);
    computeMsAdjacent(session.board, rows, cols);
    session.minesPlaced = true;
  }

  const cell = session.board[row][col];

  // ── خانهٔ باز‌شده ──
  if (cell.revealed) {
    if (cell.isMine) {
      const finder =
        cell.foundBy === null ? null : session.players.find((p) => p.seat === cell.foundBy);
      const who = finder ? `${colourBadge(finder)} ${safeName(finder.name)}` : 'کسی';
      await ctx.answerCbQuery(`💣 این مین را ${who} پیدا کرده است.`);
      return;
    }

    // گزارش کاربران: «عدد این خانه غلط است». عدد *همهٔ* مین‌های اطراف را می‌شمارد
    // و مینِ پیدا‌نشده زیر ◽ پنهان می‌ماند؛ پس همین‌جا می‌گوییم چندتا پیدا شده
    // و چندتا هنوز پنهان است تا عدد قابل بررسی باشد (بدون لو دادن جای مین‌ها).
    const info = msNeighbourMines(session.board, rows, cols, row, col);
    const audit = info
      ? `🔎 ${faNum(info.total)} مین: ${faNum(info.found)} پیدا شده، ${faNum(info.hidden)} هنوز پنهان`
      : '';

    const chord = openAroundFound(session.board, rows, cols, row, col, turn.seat);
    if (!chord) {
      await ctx.answerCbQuery(
        cell.adjacent === 0
          ? 'این خانه عدد ندارد؛ اطرافش با باز کردن خانه‌های عدددار باز می‌شود.'
          : `${audit} — تا مین‌هایش یکی‌یکی پیدا نشوند اطرافش یک‌جا باز نمی‌شود.`
      );
      return;
    }
    if (chord.opened === 0) {
      await ctx.answerCbQuery(`اطراف این خانه قبلاً باز شده است. ${audit}`);
      return;
    }

    advanceTurn(session);
    await ctx.answerCbQuery(`⛏️ ${faNum(chord.opened)} خانهٔ اطراف باز شد — نوبت نفر بعد. ${audit}`);
    if (await maybeFinishMs(ctx, session)) return;
    await updateMsMessage(ctx, session);
    return;
  }

  // ── ضربه روی خانهٔ پوشیده ──
  const tap = tapMsCell(session.board, rows, cols, row, col, turn.seat);

  if (tap.kind === 'invalid') {
    await ctx.answerCbQuery(
      tap.reason === 'already-open' ? 'این خانه قبلاً باز شده است.' : '❌ خانهٔ نامعتبر!'
    );
    return;
  }

  if (tap.kind === 'mine') {
    const mineCount = minesFoundBySeat(session.board, turn.seat);
    await ctx.answerCbQuery(
      `💣 آفرین! مین ${faNum(mineCount)} شما شد (+۱) — نوبت هم پیش تو می‌ماند.`
    );
    if (await maybeFinishMs(ctx, session)) return;
    await updateMsMessage(ctx, session);
    return;
  }

  advanceTurn(session);
  await ctx.answerCbQuery(
    tap.opened > 1
      ? `⛏️ ${faNum(tap.opened)} خانه هم‌زمان باز شد — نوبت نفر بعد.`
      : '⛏️ امن بود — نوبت نفر بعد.'
  );
  if (await maybeFinishMs(ctx, session)) return;
  await updateMsMessage(ctx, session);
}

/** پایان بازی: همهٔ مین‌ها پیدا شده، یا فقط مین‌ها پنهان مانده‌اند */
async function maybeFinishMs(ctx: Context, session: MsSession): Promise<boolean> {
  const { rows, cols, mines } = session.difficulty;
  const state = msBoardState(session.board, rows, cols, mines);

  if (state.allMinesFound) {
    await finishMinesweeper(ctx, session, 'همهٔ مین‌ها یکی‌یکی پیدا شدند!');
    return true;
  }
  if (state.hiddenLeft > 0 && state.hiddenLeft === state.minesLeft) {
    await finishMinesweeper(
      ctx,
      session,
      'همهٔ خانه‌های امن باز شد و فقط مین‌ها پنهان ماندند؛ بازی تمام می‌شود.'
    );
    return true;
  }
  return false;
}

async function finishMinesweeper(ctx: Context, session: MsSession, reason: string) {
  session.status = 'finished';

  revealUnfoundMines(session.board);

  const ranked = rankMsStandings(standingsOf(session));
  session.outcome = {
    winnerSeat: ranked.draw ? null : (ranked.ordered[0]?.seat ?? null),
    draw: ranked.draw,
    reason,
  };

  const awards = await awardMsPoints(ctx, session, ranked.ordered, ranked.draw);

  // ۱) پیام تخته فقط تختهٔ آخر را نگه می‌دارد
  await updateMsMessage(ctx, session);
  // ۲) برنده و نتیجه در یک پیام *جداگانه* اعلام می‌شوند (درخواست مالک)
  await sendMsResultMessage(ctx, session, ranked.ordered, ranked.draw, awards);

  // ۲۰ ثانیه بعد همهٔ پیام‌های بازی (تخته + نتیجه) از گروه پاک می‌شود
  void purgeGameMessages(ctx.telegram, sessionKey(session.chatId), MS_PURGE_DELAY_MS);
}

interface MsAward {
  seat: number;
  mines: number;
  minePoints: number;
  bonus: number;
  total: number;
}

async function awardMsPoints(
  ctx: Context,
  session: MsSession,
  ordered: MsStanding[],
  draw: boolean
): Promise<MsAward[]> {
  const botId = (ctx as any).botId;
  const winnerSeat = draw ? null : (ordered[0]?.seat ?? null);
  const awards: MsAward[] = [];

  for (const player of session.players) {
    const standing = ordered.find((s) => s.seat === player.seat);
    const mines = standing?.mines ?? 0;
    const minePoints = mines * MINE_POINTS;
    const bonus = winnerSeat === player.seat ? session.difficulty.bonus : 0;
    const total = PARTICIPATION_POINTS + minePoints + bonus;
    awards.push({ seat: player.seat, mines, minePoints, bonus, total });

    try {
      const user = await prisma.user.findFirst({
        where: { telegramId: BigInt(player.id), botId },
      });
      if (!user) continue;

      await prisma.user.update({ where: { id: user.id }, data: { points: { increment: total } } });
      await prisma.pointTransaction.create({
        data: {
          userId: user.id,
          amount: total,
          type: 'BONUS',
          description:
            winnerSeat === player.seat
              ? 'بازی مین‌روب — برنده'
              : 'بازی مین‌روب — شرکت در بازی',
        },
      });
    } catch {}
  }

  return awards;
}

/** پیام جداگانهٔ اعلام برنده و نتیجهٔ بازی */
async function sendMsResultMessage(
  ctx: Context,
  session: MsSession,
  ordered: MsStanding[],
  draw: boolean,
  awards: MsAward[]
): Promise<void> {
  const key = sessionKey(session.chatId);
  const playerOf = (seat: number) => session.players.find((p) => p.seat === seat);
  const lines: string[] = [];

  lines.push('🏁 *نتیجهٔ بازی مین‌روب*');
  if (session.outcome) lines.push(`🎯 ${session.outcome.reason}`);
  lines.push('');

  lines.push('📊 *مین‌های پیدا‌شده:*');
  for (const s of ordered) {
    const p = playerOf(s.seat);
    if (!p) continue;
    lines.push(`${colourBadge(p)} ${mentionUser(p)} — ${faNum(s.mines)} مین`);
  }

  lines.push('');
  const winnerSeat = draw ? null : (ordered[0]?.seat ?? null);
  if (winnerSeat === null) {
    lines.push('🤝 *مساوی شد!* هر دو نفر مین و خانهٔ باز یکسانی دارند؛ جایزه‌ای پرداخت نمی‌شود.');
  } else {
    const winner = playerOf(winnerSeat);
    const top = ordered[0];
    const runner = ordered[1];
    const how =
      runner && runner.mines === top.mines
        ? `مین‌ها مساوی (${faNum(top.mines)}) — خانهٔ امنِ بازِ بیشتر: ${faNum(top.opened)}`
        : `${faNum(top.mines)} مین`;
    if (winner) lines.push(`🏆 *برنده:* ${colourBadge(winner)} ${mentionUser(winner)} — ${how}`);
  }

  lines.push('');
  lines.push('💰 *امتیاز این بازی:*');
  for (const a of awards) {
    const p = playerOf(a.seat);
    if (!p) continue;
    const parts = [`${faNum(PARTICIPATION_POINTS)} شرکت`, `${faNum(a.minePoints)} مین`];
    if (a.bonus > 0) parts.push(`${faNum(a.bonus)} جایزهٔ برنده`);
    lines.push(`${colourBadge(p)} ${faNum(a.total)} = ${parts.join(' + ')}`);
  }

  lines.push('');
  lines.push(`🧹 تا ${faNum(MS_PURGE_DELAY_MS / 1000)} ثانیه دیگر این پیام و تخته از گروه پاک می‌شود.`);

  await sendGameMessage(ctx, key, lines.join('\n'), { parse_mode: 'Markdown' });
}

async function updateMsMessage(ctx: Context, session: MsSession) {
  try {
    await ctx.editMessageText(buildMsText(session), {
      parse_mode: 'Markdown',
      ...buildMsKeyboard(session),
    });
  } catch {}
}

// Cleanup expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS + 60_000) {
      sessions.delete(key);
    }
  }
}, 60_000);
