import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import {
  GAME_CANCEL_PURGE_DELAY_MS,
  GAME_RESULT_PURGE_DELAY_MS,
  checkGameChannelJoin,
  purgeGameMessages,
  requireGroup,
  sendGameMessage,
} from './utils.js';
import {
  MAX_MS_PLAYERS,
  MIN_MS_PLAYERS,
  MS_EMOJI,
  MS_NAME_FA,
  MsCell,
  MsDifficulty,
  MsDifficultyKey,
  MsStanding,
  colourForSeat,
  computeMsAdjacent,
  createMsBoard,
  getMsDifficulty,
  minesFoundBySeat,
  msBoardState,
  msCellLabel,
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
  status: 'choosing' | 'waiting' | 'playing' | 'finished';
  minesPlaced: boolean;
  outcome: MsOutcome | null;
  createdAt: number;
}

/** شرکت همه بازیکنان + امتیاز هر مین + جایزهٔ سطح برای برنده */
const PARTICIPATION_POINTS = 10;
const MINE_POINTS = 3;
const SESSION_TTL_MS = 30 * 60_000;

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
  if (session.status === 'choosing') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🟢 آسان', 'ms_diff_easy'),
        Markup.button.callback('🟡 متوسط', 'ms_diff_medium'),
      ],
      [Markup.button.callback('🔴 سخت', 'ms_diff_hard')],
      [Markup.button.callback('❌ لغو', 'ms_cancel')],
    ]);
  }

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
    const nextSeat = session.players.length;
    if (nextSeat < MAX_MS_PLAYERS) {
      const colour = colourForSeat(nextSeat);
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
  if (session.status === 'waiting' || session.status === 'choosing') {
    return `${badge} ${mentionUser(player)}`;
  }
  const mines = minesFoundBySeat(session.board, player.seat);
  const opened = safeOpenedBySeat(session.board, player.seat);
  return `${badge} ${mentionUser(player)} — ${faNum(mines)} مین · ${faNum(opened)} خانه`;
}

function playersBlock(session: MsSession): string {
  return session.players.map((p) => playerLine(session, p)).join('\n');
}

function buildMsText(session: MsSession): string {
  const { label, mines } = session.difficulty;

  if (session.status === 'choosing') {
    return (
      '💣 *مین‌روب — مسابقهٔ رنگ‌ها*\n\n' +
      '🎯 *سطح سختی را انتخاب کنید:*\n' +
      `🟢 آسان — ${sizeLabel(getMsDifficulty('easy'))}\n` +
      `🟡 متوسط — ${sizeLabel(getMsDifficulty('medium'))}\n` +
      `🔴 سخت — ${sizeLabel(getMsDifficulty('hard'))}\n\n` +
      '📌 *قانون بازی:*\n' +
      '• بازی *نوبتی* است؛ نفر اول 🔴 قرمز، نفر دوم 🔵 آبی، نفر سوم 🟢 سبز (تا ۶ نفر)\n' +
      '• روی *مین* بزنی: خانه با رنگ تو علامت می‌خورد، ۱ امتیاز می‌گیری و *نوبت هم پیش تو می‌ماند*\n' +
      '• روی *خانهٔ امن* بزنی: عددِ مین‌های اطرافش باز می‌شود (خانهٔ صفر کل ناحیه را باز می‌کند) و نوبت به نفر بعد می‌رود\n' +
      '• اگر روی خانهٔ عدددار بزنی و همهٔ مین‌های اطرافش علامت خورده باشند، بقیهٔ خانه‌های اطراف یک‌جا باز می‌شوند\n' +
      '• جان و جریمه‌ای وجود ندارد؛ *هرکس مین بیشتری پیدا کند برنده است*\n' +
      '• بازی وقتی تمام می‌شود که همهٔ مین‌ها پیدا شوند یا فقط مین‌ها پنهان بمانند'
    );
  }

  const state = msBoardState(session.board, session.difficulty.rows, session.difficulty.cols, mines);
  const lines: string[] = [];

  lines.push(`💣 *مین‌روب — ${label}* (${sizeLabel(session.difficulty)})`);

  if (session.status === 'waiting') {
    lines.push('');
    lines.push(`👥 *بازیکنان (${faNum(session.players.length)}):`);
    lines.push(playersBlock(session) || '—');
    lines.push('');
    if (session.players.length < MIN_MS_PLAYERS) {
      const colour = colourForSeat(session.players.length);
      lines.push(
        `⏳ منتظر بازیکن دوم… نفر بعدی ${MS_EMOJI[colour]} ${MS_NAME_FA[colour]} می‌شود؛ دکمهٔ «🎮 پیوستن به بازی» را بزند.`
      );
    } else {
      lines.push('✅ بازیکنان آماده‌اند! شروع‌کننده دکمهٔ «▶️ شروع بازی» را بزند.');
    }
    lines.push('');
    lines.push('🔴 شروع‌کننده نوبت اول را دارد و مین‌ها بعد از شروع چیده می‌شوند.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push(
    `🚩 مین پیدا‌شده: ${faNum(state.minesFound)} از ${faNum(mines)} | ` +
      `⬜ خانهٔ باز‌نشده: ${faNum(state.hiddenLeft)}`
  );
  lines.push('');
  lines.push('👥 *بازیکنان:*');
  lines.push(playersBlock(session) || '—');

  if (session.status === 'finished') {
    lines.push('');
    const outcome = session.outcome;
    if (outcome && outcome.winnerSeat !== null) {
      const winner = session.players.find((p) => p.seat === outcome.winnerSeat);
      if (winner) {
        const standing = standingsOf(session).find((s) => s.seat === winner.seat);
        lines.push(
          `🏆 *برنده:* ${colourBadge(winner)} ${mentionUser(winner)} — ${faNum(standing?.mines ?? 0)} مین`
        );
      }
    } else if (outcome?.draw) {
      lines.push('🤝 *مساوی شد!* در مین و در خانهٔ باز‌شده.');
    } else {
      lines.push('🏁 بازی تمام شد.');
    }
    if (outcome) lines.push(`🎯 ${outcome.reason}`);
    lines.push('');
    lines.push(
      `⭐️ ${faNum(PARTICIPATION_POINTS)} امتیاز شرکت + ${faNum(MINE_POINTS)} برای هر مین` +
        (outcome && outcome.winnerSeat !== null
          ? ` + ${faNum(session.difficulty.bonus)} جایزهٔ برنده`
          : '') +
        '.'
    );
    lines.push('🧹 پیام‌های این بازی کمی بعد از گروه پاک می‌شود.');
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

  const difficulty = getMsDifficulty('easy');
  const session: MsSession = {
    chatId,
    messageId: 0,
    starterId: ctx.from!.id,
    difficulty,
    board: createMsBoard(difficulty.rows, difficulty.cols),
    players: [],
    currentSeat: 0,
    status: 'choosing',
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

  // ── انتخاب سطح سختی ──
  if (action.startsWith('ms_diff_')) {
    if (session.status !== 'choosing') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }

    const diffKey = action.replace('ms_diff_', '') as MsDifficultyKey;
    const diff = getMsDifficulty(diffKey);
    session.difficulty = diff;
    session.board = createMsBoard(diff.rows, diff.cols);
    session.minesPlaced = false;
    session.status = 'waiting';
    session.starterId = userId;

    session.players.push({
      id: userId,
      name: ctx.from!.first_name || 'بازیکن',
      seat: 0,
    });
    session.currentSeat = 0;

    await ctx.answerCbQuery(`🎯 سطح ${diff.label} — شما ${MS_EMOJI.red} قرمز هستید.`);
    await updateMsMessage(ctx, session);
    return;
  }

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
      await ctx.answerCbQuery(`❌ حداکثر ${faNum(MAX_MS_PLAYERS)} بازیکن!`);
      return;
    }

    const seat = session.players.length;
    session.players.push({ id: userId, name: ctx.from!.first_name || 'بازیکن', seat });
    const colour = colourForSeat(seat);

    await ctx.answerCbQuery(
      session.players.length < MIN_MS_PLAYERS
        ? `🎮 پیوستی! رنگ شما ${MS_EMOJI[colour]} ${MS_NAME_FA[colour]} — منتظر بازیکن بعدی.`
        : `🎮 پیوستی! رنگ شما ${MS_EMOJI[colour]} ${MS_NAME_FA[colour]} 🎉`
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
    if (session.starterId !== userId) {
      await ctx.answerCbQuery('❌ فقط شروع‌کنندهٔ بازی می‌تواند بازی را استارت بزند.');
      return;
    }
    if (session.players.length < MIN_MS_PLAYERS) {
      await ctx.answerCbQuery('❌ برای شروع بازی حداقل ۲ بازیکن لازم است!');
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
        'روی خانهٔ امن بزنی عددش باز می‌شود و نوبت به نفر بعد می‌رود. بیشترین مین = برنده.',
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
      await ctx.editMessageText('❌ بازی مین‌روب لغو شد.');
    } catch {}
    void purgeGameMessages(ctx.telegram, key, GAME_CANCEL_PURGE_DELAY_MS);
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

    const chord = openAroundFound(session.board, rows, cols, row, col, turn.seat);
    if (!chord) {
      await ctx.answerCbQuery(
        cell.adjacent === 0
          ? 'این خانه عدد ندارد؛ اطرافش با باز کردن خانه‌های عدددار باز می‌شود.'
          : `اطراف این خانه فقط وقتی یک‌جا باز می‌شود که ${faNum(cell.adjacent)} مینِ آن علامت خورده باشد.`
      );
      return;
    }
    if (chord.opened === 0) {
      await ctx.answerCbQuery('اطراف این خانه قبلاً باز شده است.');
      return;
    }

    advanceTurn(session);
    await ctx.answerCbQuery(`⛏️ ${faNum(chord.opened)} خانهٔ اطراف باز شد — نوبت نفر بعد.`);
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

  await awardMsPoints(ctx, session, ranked.ordered, ranked.draw);
  await updateMsMessage(ctx, session);

  // نتیجه مدت کوتاهی روی صفحه می‌ماند، بعد همهٔ پیام‌های بازی از گروه پاک می‌شود
  void purgeGameMessages(ctx.telegram, sessionKey(session.chatId), GAME_RESULT_PURGE_DELAY_MS);
}

async function awardMsPoints(
  ctx: Context,
  session: MsSession,
  ordered: MsStanding[],
  draw: boolean
): Promise<number> {
  const botId = (ctx as any).botId;
  const winnerSeat = draw ? null : (ordered[0]?.seat ?? null);
  let awarded = 0;

  for (const player of session.players) {
    const standing = ordered.find((s) => s.seat === player.seat);
    const minePoints = (standing?.mines ?? 0) * MINE_POINTS;
    const bonus = winnerSeat === player.seat ? session.difficulty.bonus : 0;
    const total = PARTICIPATION_POINTS + minePoints + bonus;

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
      awarded += total;
    } catch {}
  }

  return awarded;
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
