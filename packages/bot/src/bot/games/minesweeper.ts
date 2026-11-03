import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { requireGroup, checkGameChannelJoin } from './utils.js';
import {
  MsCell,
  MsDifficulty,
  MsDifficultyKey,
  chordMs,
  computeMsAdjacent,
  createMsBoard,
  getMsDifficulty,
  msBoardState,
  placeMsMines,
  revealMsFlood,
} from './minesweeper-logic.js';

// ─── Types ───────────────────────────────────
interface MsPlayer {
  id: number;
  name: string;
  lives: number;
  revealed: number;
  flags: number;
  eliminated: boolean;
}

interface MsSession {
  chatId: number;
  messageId: number;
  difficulty: MsDifficulty;
  board: MsCell[][];
  players: Map<number, MsPlayer>;
  turnOrder: number[];
  currentTurnIndex: number;
  status: 'choosing' | 'waiting' | 'playing' | 'finished';
  flagMode: boolean;
  minesPlaced: boolean;
  winner: { id: number; name: string; reason: string } | null;
  createdAt: number;
}

const MAX_PLAYERS = 6;
const START_LIVES = 3;

const sessions = new Map<string, MsSession>();

function sessionKey(chatId: number): string {
  return `ms:${chatId}`;
}

// ─── Helpers ─────────────────────────────────
/** بازیکنِ نوبت فعلی (بازیکنان حذف‌شده نادیده گرفته می‌شوند) */
function currentPlayer(session: MsSession): MsPlayer | null {
  const n = session.turnOrder.length;
  if (n === 0) return null;
  for (let i = 0; i < n; i++) {
    const idx = (session.currentTurnIndex + i) % n;
    const player = session.players.get(session.turnOrder[idx]);
    if (player && !player.eliminated) {
      session.currentTurnIndex = idx;
      return player;
    }
  }
  return null;
}

function advanceTurn(session: MsSession): void {
  const n = session.turnOrder.length;
  if (n === 0) return;
  for (let i = 1; i <= n; i++) {
    const idx = (session.currentTurnIndex + i) % n;
    const player = session.players.get(session.turnOrder[idx]);
    if (player && !player.eliminated) {
      session.currentTurnIndex = idx;
      return;
    }
  }
}

/** بازیکنانِ باقی‌مانده (بدون حذف‌شده‌ها) */
function alivePlayers(session: MsSession): MsPlayer[] {
  return Array.from(session.players.values()).filter((p) => !p.eliminated);
}

/** بهترین بازیکن بر اساس بیشترین خانهٔ باز شده (و سپس بیشترین پرچم درست) */
function pickTopScorer(session: MsSession): MsPlayer | null {
  const alive = alivePlayers(session);
  const pool = alive.length > 0 ? alive : Array.from(session.players.values());
  if (pool.length === 0) return null;
  return pool.slice().sort((a, b) => {
    if (b.revealed !== a.revealed) return b.revealed - a.revealed;
    if (b.flags !== a.flags) return b.flags - a.flags;
    return session.turnOrder.indexOf(a.id) - session.turnOrder.indexOf(b.id);
  })[0];
}

function msCellLabel(cell: MsCell): string {
  if (!cell.revealed) {
    return cell.flagged ? '🚩' : '⬜';
  }
  if (cell.isMine) return '💣';
  if (cell.adjacent === 0) return '·';
  return String(cell.adjacent);
}

/** رنگ دکمه‌ها بر اساس عدد خانه (مثل مین‌روب کلاسیک) */
function msCellStyle(cell: MsCell): 'danger' | 'success' | 'primary' | undefined {
  if (!cell.revealed || cell.isMine || cell.adjacent === 0) return undefined;
  if (cell.adjacent === 1 || cell.adjacent === 4 || cell.adjacent === 8) return 'primary';
  if (cell.adjacent === 2 || cell.adjacent === 6) return 'success';
  return 'danger';
}

// ─── Keyboard ────────────────────────────────
function buildMsKeyboard(session: MsSession): any {
  const { rows, cols } = session.difficulty;

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

  const keyboard: any[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: any[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = session.board[r][c];
      const label = msCellLabel(cell);
      const action = cell.revealed ? `ms_open_${r}_${c}` : `ms_pick_${r}_${c}`;
      const button: any = Markup.button.callback(label, action);
      const style = msCellStyle(cell);
      if (style) button.style = style;
      row.push(button);
    }
    keyboard.push(row);
  }

  if (session.status === 'waiting') {
    keyboard.push([
      Markup.button.callback('🎮 پیوستن به بازی', 'ms_join'),
      Markup.button.callback('▶️ شروع بازی', 'ms_start'),
    ]);
    keyboard.push([Markup.button.callback('❌ لغو', 'ms_cancel')]);
    return Markup.inlineKeyboard(keyboard);
  }

  if (session.status === 'finished') {
    keyboard.push([
      Markup.button.callback('🔄 بازی جدید', 'ms_new'),
      Markup.button.callback('🎙 منوی بازی', 'games'),
    ]);
    return Markup.inlineKeyboard(keyboard);
  }

  keyboard.push([
    Markup.button.callback(
      session.flagMode ? '🚩 پرچم‌گذاری: روشن' : '🚩 پرچم‌گذاری: خاموش',
      'ms_flagmode'
    ),
    Markup.button.callback('ℹ️ راهنما', 'ms_help'),
  ]);
  keyboard.push([Markup.button.callback('❌ لغو بازی', 'ms_cancel')]);

  return Markup.inlineKeyboard(keyboard);
}

// ─── Message text ────────────────────────────
function buildMsText(session: MsSession): string {
  const { rows, cols, mines, label } = session.difficulty;
  const state = msBoardState(session.board, rows, cols, mines);

  if (session.status === 'choosing') {
    return (
      '💣 *بازی مین‌روب*\n\n' +
      '🎯 *سطح سختی را انتخاب کنید:*\n' +
      '🟢 آسان — ۶×۷ با ۸ مین\n' +
      '🟡 متوسط — ۸×۸ با ۱۲ مین\n' +
      '🔴 سخت — ۹×۹ با ۲۰ مین\n\n' +
      '📌 *قانون بازی:* مین‌ها را پیدا کنید!\n' +
      '• خانه‌های امن را باز کنید تا محلهٔ خالی اطرافشان هم باز شود\n' +
      '• با دکمه «🚩 پرچم‌گذاری» می‌توانید مین‌ها را علامت بزنید\n' +
      '• هر بازیکن ۳ جان دارد؛ زدن روی مین یک جان کم می‌کند\n' +
      '• هرکس زودتر همهٔ مین‌ها را پیدا کند یا همهٔ خانه‌های امن را باز کند، برنده است\n' +
      '• اگر همهٔ بازیکنان حذف شوند، بیشترین خانهٔ باز شده برنده می‌شود'
    );
  }

  const playersList = Array.from(session.players.values())
    .map((p) => {
      const hearts = '❤️'.repeat(Math.max(0, p.lives));
      const empty = '🖤'.repeat(Math.max(0, START_LIVES - p.lives));
      const mark = p.eliminated ? '❌ ' : '';
      return `${mark}${mentionUser(p.id, p.name)} ${hearts}${empty} — ${p.revealed} خانه`;
    })
    .join('\n');

  const lines: string[] = [];
  lines.push(`💣 *مین‌روب — ${label}*`);
  lines.push('');
  lines.push(`⛏️ مین‌ها: ${mines} | 🟩 خانهٔ امن: ${state.totalSafe}`);
  lines.push(`🚩 پرچم: ${state.flags.total} از ${mines}`);
  lines.push(`📊 باز شده: ${state.revealedSafe} از ${state.totalSafe}`);

  if (session.status === 'waiting') {
    lines.push('');
    lines.push(`👥 *بازیکنان (${session.players.size}):*`);
    lines.push(playersList || '—');
    lines.push('');
    lines.push(
      session.players.size < 2
        ? '⏳ منتظر بازیکن دوم… نفر دوم دکمهٔ «🎮 پیوستن به بازی» را بزند.'
        : '✅ بازیکن دوم پیوست! شروع‌کننده دکمهٔ «▶️ شروع بازی» را بزند.'
    );
    return lines.join('\n');
  }

  if (session.status === 'finished') {
    lines.push('');
    lines.push(`👥 *بازیکنان:*`);
    lines.push(playersList || '—');
    lines.push('');
    if (session.winner) {
      lines.push(`🏆 *برنده:* ${mentionUser(session.winner.id, session.winner.name)}`);
      lines.push(`🎯 ${session.winner.reason}`);
      lines.push(`⭐️ ${session.difficulty.points} امتیاز دریافت شد!`);
    } else {
      lines.push('🏁 بازی بدون برنده تمام شد!');
    }
    return lines.join('\n');
  }

  lines.push('');
  lines.push(`👥 *بازیکنان:*`);
  lines.push(playersList || '—');
  lines.push('');
  const turn = currentPlayer(session);
  lines.push(`🎯 نوبت: ${turn ? mentionUser(turn.id, turn.name) : '—'}`);
  lines.push(
    session.flagMode
      ? '🚩 حالت پرچم‌گذاری **روشن** است — با زدن روی خانه، مین علامت زده می‌شود.'
      : '⛏️ حالت **حف** فعال است — با زدن روی خانه، آن خانه باز می‌شود.'
  );

  return lines.join('\n');
}

// ─── Start Minesweeper ───────────────────────
export async function handleMinesweeper(ctx: Context) {
  if (!(await requireGroup(ctx, 'مین‌روب'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < 1800000) {
    await ctx.reply('⏳ یک بازی مین‌روب در حال انجام است. لطفاً صبر کنید تا تمام شود.');
    return;
  }

  const difficulty = getMsDifficulty('easy');
  const session: MsSession = {
    chatId,
    messageId: 0,
    difficulty,
    board: createMsBoard(difficulty.rows, difficulty.cols),
    players: new Map(),
    turnOrder: [],
    currentTurnIndex: 0,
    status: 'choosing',
    flagMode: false,
    minesPlaced: false,
    winner: null,
    createdAt: Date.now(),
  };
  sessions.set(key, session);

  const msg = await ctx.reply(buildMsText(session), {
    parse_mode: 'Markdown',
    ...buildMsKeyboard(session),
  });

  session.messageId = msg.message_id;
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

  // ── انتخاب سختی ──
  if (action.startsWith('ms_diff_')) {
    if (session.status !== 'choosing' && session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    const wasChoosing = session.status === 'choosing';
    const diffKey = action.replace('ms_diff_', '') as MsDifficultyKey;
    const diff = getMsDifficulty(diffKey);
    session.difficulty = diff;
    session.board = createMsBoard(diff.rows, diff.cols);
    session.minesPlaced = false;
    session.status = 'waiting';

    // آغازگر بازی به‌صورت خودکار بازیکن اول می‌شود
    if (wasChoosing && !session.players.has(userId)) {
      session.players.set(userId, {
        id: userId,
        name: ctx.from!.first_name || 'بازیکن',
        lives: START_LIVES,
        revealed: 0,
        flags: 0,
        eliminated: false,
      });
      session.turnOrder.push(userId);
    }

    await ctx.answerCbQuery(`🎯 سطح ${diff.label} انتخاب شد.`);
    await updateMsMessage(ctx, session);
    return;
  }

  // ── پیوستن ──
  if (action === 'ms_join') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (session.players.has(userId)) {
      await ctx.answerCbQuery('شما قبلاً پیوسته‌اید!');
      return;
    }
    if (session.players.size >= MAX_PLAYERS) {
      await ctx.answerCbQuery(`❌ حداکثر ${MAX_PLAYERS} بازیکن!`);
      return;
    }

    session.players.set(userId, {
      id: userId,
      name: ctx.from!.first_name || 'بازیکن',
      lives: START_LIVES,
      revealed: 0,
      flags: 0,
      eliminated: false,
    });
    session.turnOrder.push(userId);

    await ctx.answerCbQuery('🎮 به بازی پیوستی!');
    await updateMsMessage(ctx, session);
    return;
  }

  // ── شروع بازی ──
  if (action === 'ms_start') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (session.turnOrder[0] !== userId) {
      await ctx.answerCbQuery('❌ فقط شروع‌کننده بازی می‌تواند بازی را استارت بزند.');
      return;
    }
    if (session.players.size < 2) {
      await ctx.answerCbQuery('❌ برای شروع بازی حداقل ۲ بازیکن باید پیوسته باشند!');
      return;
    }

    session.status = 'playing';
    session.currentTurnIndex = 0;

    await ctx.answerCbQuery('🎮 بازی شروع شد! نوبت اول با ❌ است.');
    await updateMsMessage(ctx, session);
    return;
  }

  // ── حالت پرچم‌گذاری ──
  if (action === 'ms_flagmode') {
    session.flagMode = !session.flagMode;
    await ctx.answerCbQuery(
      session.flagMode
        ? '🚩 حالت پرچم‌گذاری روشن شد — زدن روی خانه، مین را علامت می‌زند.'
        : '⛏️ حالت حف روشن شد — زدن روی خانه، آن را باز می‌کند.'
    );
    await updateMsMessage(ctx, session);
    return;
  }

  if (action === 'ms_help') {
    await ctx.answerCbQuery(
      'قانون: مین‌ها را پیدا کنید. روی خانهٔ ۰ بزنید تا کل ناحیه باز شود؛ روی خانهٔ عدددار بزنید تا اگر پرچم‌ها کامل بود اطرافش باز شود. هر بازیکن ۳ جان دارد.',
      { show_alert: true }
    );
    return;
  }

  // ── لغو ──
  if (action === 'ms_cancel') {
    if (!session.players.has(userId)) {
      await ctx.answerCbQuery('❌ شما بازیکن این بازی نیستید.');
      return;
    }
    sessions.delete(key);
    await ctx.answerCbQuery('بازی لغو شد.');
    try {
      await ctx.editMessageText('❌ بازی مین‌روب لغو شد.');
    } catch {}
    return;
  }

  // ── بازی جدید ──
  if (action === 'ms_new') {
    session.players.clear();
    session.turnOrder = [];
    session.currentTurnIndex = 0;
    session.status = 'waiting';
    session.flagMode = false;
    session.minesPlaced = false;
    session.winner = null;
    session.board = createMsBoard(session.difficulty.rows, session.difficulty.cols);

    await ctx.answerCbQuery('🔄 بازی جدید آماده شد — منتظر بازیکن!');
    await updateMsMessage(ctx, session);
    return;
  }

  // ── کلیک روی خانه ──
  if (action.startsWith('ms_pick_') || action.startsWith('ms_open_')) {
    await handleMsCellClick(ctx, session, action);
    return;
  }
}

async function handleMsCellClick(ctx: Context, session: MsSession, action: string) {
  const userId = ctx.from!.id;

  if (session.status !== 'playing') {
    await ctx.answerCbQuery('⏳ بازی هنوز شروع نشده!');
    return;
  }

  const player = currentPlayer(session);
  if (!player) {
    await ctx.answerCbQuery('بازیکنی برای نوبت فعلی نیست.');
    return;
  }
  if (player.id !== userId) {
    await ctx.answerCbQuery(`⏳ نوبت ${player.name} است!`);
    return;
  }

  const parts = action.split('_');
  const row = parseInt(parts[2], 10);
  const col = parseInt(parts[3], 10);
  const { rows, cols, mines } = session.difficulty;

  if (Number.isNaN(row) || Number.isNaN(col) || row < 0 || row >= rows || col < 0 || col >= cols) {
    await ctx.answerCbQuery('❌ خانهٔ نامعتبر!');
    return;
  }

  const cell = session.board[row][col];

  // ── حالت پرچم‌گذاری ──
  if (session.flagMode) {
    if (cell.revealed) {
      await ctx.answerCbQuery('این خانه قبلاً باز شده است.');
      return;
    }
    cell.flagged = !cell.flagged;
    player.flags += cell.flagged ? 1 : -1;

    const state = msBoardState(session.board, rows, cols, mines);
    if (state.allMinesFound) {
      await finishMinesweeper(ctx, session, player, 'همهٔ مین‌ها را پیدا کردید!');
      return;
    }

    await ctx.answerCbQuery(cell.flagged ? '🚩 پرچم زده شد.' : 'پرچم برداشته شد.');
    advanceTurn(session);
    await updateMsMessage(ctx, session);
    return;
  }

  // ── حالت حف ──
  if (cell.flagged) {
    await ctx.answerCbQuery('🚩 این خانه پرچم دارد؛ اول پرچم را بردارید.');
    return;
  }

  // کلیک روی خانهٔ باز شده → تلاش برای «باز کردن اطراف» (Chord)
  if (cell.revealed) {
    const chord = chordMs(session.board, rows, cols, row, col);
    if (!chord) {
      await ctx.answerCbQuery(
        cell.adjacent === 0
          ? 'این خانه عدد ندارد؛ اطرافش با زدن روی خانه‌های عدددار باز می‌شود.'
          : `برای باز کردن اطراف، تعداد پرچم‌ها باید ${cell.adjacent} باشد.`
      );
      return;
    }

    player.revealed += chord.revealed;

    if (chord.mineHit) {
      await handleMsMineHit(ctx, session, player);
      return;
    }

    const state = msBoardState(session.board, rows, cols, mines);
    if (state.allSafeRevealed) {
      await finishMinesweeper(ctx, session, player, 'همهٔ خانه‌های امن را باز کردید!');
      return;
    }

    await ctx.answerCbQuery(`⛏️ ${chord.revealed} خانه باز شد.`);
    advanceTurn(session);
    await updateMsMessage(ctx, session);
    return;
  }

  // اولین کلیک بازی: مین‌ها با اطمینان از خانهٔ اول و همسایه‌هایش دور می‌شوند
  if (!session.minesPlaced) {
    placeMsMines(session.board, rows, cols, mines, row, col);
    computeMsAdjacent(session.board, rows, cols);
    session.minesPlaced = true;
  }

  const result = revealMsFlood(session.board, rows, cols, row, col);

  if (result.mineHit) {
    await handleMsMineHit(ctx, session, player);
    return;
  }

  player.revealed += result.revealed;

  const state = msBoardState(session.board, rows, cols, mines);
  if (state.allSafeRevealed) {
    await finishMinesweeper(ctx, session, player, 'همهٔ خانه‌های امن را باز کردید!');
    return;
  }

  await ctx.answerCbQuery(
    result.revealed > 1
      ? `⛏️ حفره باز شد! ${result.revealed} خانه هم‌زمان باز شد.`
      : '⛏️ امن بود.'
  );
  advanceTurn(session);
  await updateMsMessage(ctx, session);
}

async function handleMsMineHit(ctx: Context, session: MsSession, player: MsPlayer) {
  player.lives--;

  if (player.lives <= 0) {
    player.eliminated = true;

    const remaining = alivePlayers(session);
    if (remaining.length === 0) {
      // همه از بازی خارج شدند — بیشترین خانهٔ باز شده برنده است
      const top = pickTopScorer(session);
      await ctx.answerCbQuery('💥 بمب! همهٔ بازیکنان از بازی خارج شدند.');
      await finishMinesweeper(
        ctx,
        session,
        top,
        top ? 'بیشترین خانهٔ امن را باز کرد.' : 'هیچ‌کس باقی نماند.'
      );
      return;
    }

    if (remaining.length === 1) {
      // تنها بازیکن باقی‌مانده برنده است
      await ctx.answerCbQuery(`💥 بمب! ${player.name} از بازی خارج شد.`);
      await finishMinesweeper(ctx, session, remaining[0], 'تنها بازیکن باقی‌مانده!');
      return;
    }

    await ctx.answerCbQuery(`💥 بمب! ${player.name} از بازی خارج شد.`);
    advanceTurn(session);
    await updateMsMessage(ctx, session);
    return;
  }

  await ctx.answerCbQuery(`💥 بمب! ${player.lives} جان باقی مانده.`);
  advanceTurn(session);
  await updateMsMessage(ctx, session);
}

async function finishMinesweeper(
  ctx: Context,
  session: MsSession,
  winner: MsPlayer | null,
  reason: string
) {
  session.status = 'finished';
  session.winner = winner ? { id: winner.id, name: winner.name, reason } : null;

  // همهٔ مین‌ها نمایش داده می‌شوند
  const { rows, cols } = session.difficulty;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = session.board[r][c];
      if (cell.isMine && !cell.revealed) {
        cell.revealed = true;
        cell.flagged = false;
      }
    }
  }

  await awardMsPoints(ctx, session);
  await updateMsMessage(ctx, session);
}

async function awardMsPoints(ctx: Context, session: MsSession) {
  const botId = (ctx as any).botId;
  const { points } = session.difficulty;

  for (const player of session.players.values()) {
    const bonus = player.revealed * 2;
    const total = (session.winner && session.winner.id === player.id ? points : 0) + bonus;
    if (total <= 0) continue;

    try {
      const user = await prisma.user.findFirst({
        where: { telegramId: BigInt(player.id), botId },
      });
      if (!user) continue;

      await prisma.user.update({
        where: { id: user.id },
        data: { points: { increment: total } },
      });
      await prisma.pointTransaction.create({
        data: {
          userId: user.id,
          amount: total,
          type: 'BONUS',
          description: session.winner && session.winner.id === player.id
            ? 'بازی مین‌روب — برنده'
            : 'بازی مین‌روب — شرکت در بازی',
        },
      });
    } catch {}
  }
}

async function updateMsMessage(ctx: Context, session: MsSession) {
  try {
    await ctx.editMessageText(buildMsText(session), {
      parse_mode: 'Markdown',
      ...buildMsKeyboard(session),
    });
  } catch {}
}

function mentionUser(userId: number, name: string): string {
  return `[${name}](tg://user?id=${userId})`;
}

// Cleanup expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > 3600000) {
      sessions.delete(key);
    }
  }
}, 60000);
