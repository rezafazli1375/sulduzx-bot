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
  TttBoard,
  TttMode,
  getTttMode,
  createTttBoard,
  checkTttWinner,
  isTttBoardFull,
} from './tic-tac-toe-logic.js';

// ─── Types ───────────────────────────────────
interface TttPlayer {
  id: number;
  name: string;
  mark: 'X' | 'O';
}

interface TttSession {
  chatId: number;
  messageId: number;
  mode: TttMode;
  board: TttBoard;
  playerX: TttPlayer | null;
  playerO: TttPlayer | null;
  currentTurn: 'X' | 'O';
  status: 'choosing' | 'waiting' | 'playing' | 'finished';
  winnerId: number | null;
  winLine: [number, number][];
  createdAt: number;
}

const sessions = new Map<string, TttSession>();

function sessionKey(chatId: number): string {
  return `ttt:${chatId}`;
}

// ─── Keyboard ────────────────────────────────
function buildGameKeyboard(session: TttSession): any {
  if (session.status === 'choosing') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🟦 کلاسیک ۳×۳', 'ttt_mode_classic'),
        Markup.button.callback('🟦 حرفه‌ای ۶×۷', 'ttt_mode_pro'),
      ],
      [Markup.button.callback('❌ لغو', 'ttt_cancel')],
    ]);
  }

  const { rows, cols } = session.mode;
  const keyboard: any[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: any[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = session.board[r][c];
      const label = cell === 'X' ? '❌' : cell === 'O' ? '⭕' : '▫️';
      const button: any = Markup.button.callback(
        label,
        cell ? `ttt_open_${r}_${c}` : `ttt_move_${r}_${c}`
      );
      const isWinnerCell = session.winLine.some(([wr, wc]) => wr === r && wc === c);
      if (isWinnerCell) button.style = 'success';
      row.push(button);
    }
    keyboard.push(row);
  }

  if (session.status === 'waiting') {
    keyboard.push([
      Markup.button.callback('🎮 پیوستن به بازی', 'ttt_join'),
      Markup.button.callback('▶️ شروع بازی', 'ttt_start'),
    ]);
    keyboard.push([Markup.button.callback('❌ لغو', 'ttt_cancel')]);
    return Markup.inlineKeyboard(keyboard);
  }

  if (session.status === 'finished') {
    keyboard.push([
      Markup.button.callback('🔄 بازی جدید', 'ttt_new'),
      Markup.button.callback('🎲 تغییر حالت', 'ttt_mode_menu'),
    ]);
    keyboard.push([Markup.button.callback('🎙 منوی بازی', 'games')]);
    return Markup.inlineKeyboard(keyboard);
  }

  keyboard.push([Markup.button.callback('❌ لغو بازی', 'ttt_cancel')]);
  return Markup.inlineKeyboard(keyboard);
}

// ─── Message text ────────────────────────────
function buildGameText(session: TttSession): string {
  const lines: string[] = [];
  lines.push(`❌⭕ *بازی دوز — ${session.mode.label}*`);
  lines.push('');
  lines.push(`📋 ${session.mode.description}`);
  lines.push('');

  const x = session.playerX
    ? `${mentionUser(session.playerX.id, session.playerX.name)} — ❌`
    : '❌ — منتظر بازیکن…';
  const o = session.playerO
    ? `${mentionUser(session.playerO.id, session.playerO.name)} — ⭕`
    : '⭕ — منتظر بازیکن…';
  lines.push(x);
  lines.push(o);
  lines.push('');

  if (session.status === 'choosing') {
    lines.push('🎯 *حالت بازی را انتخاب کنید:*');
    lines.push('• کلاسیک ۳×۳ — سریع و آسان');
    lines.push('• حرفه‌ای ۶×۷ — پنج مهرهٔ پشت سر هم');
    return lines.join('\n');
  }

  if (session.status === 'waiting') {
    if (!session.playerO) {
      lines.push('⏳ منتظر بازیکن دوم… نفر دوم دکمهٔ «🎮 پیوستن به بازی» را بزند.');
    } else {
      lines.push('✅ بازیکن دوم پیوست! شروع‌کننده دکمهٔ «▶️ شروع بازی» را بزند.');
    }
    return lines.join('\n');
  }

  if (session.status === 'finished') {
    if (session.winnerId) {
      const winner = session.playerX?.id === session.winnerId ? session.playerX : session.playerO;
      lines.push(`🏆 *برنده:* ${winner ? mentionUser(winner.id, winner.name) : '—'}`);
      lines.push(`⭐️ ${session.mode.points} امتیاز دریافت شد!`);
    } else {
      lines.push('🤝 *بازی مساوی شد!*');
      lines.push('⭐️ ۱۰ امتیاز برای هر دو بازیکن');
    }
    return lines.join('\n');
  }

  const turn = session.currentTurn === 'X' ? session.playerX : session.playerO;
  const symbol = session.currentTurn === 'X' ? '❌' : '⭕';
  lines.push(`🎯 *نوبت:* ${turn ? mentionUser(turn.id, turn.name) : '—'} ${symbol}`);
  return lines.join('\n');
}

// ─── Start Tic Tac Toe ───────────────────────
export async function handleTicTacToe(ctx: Context) {
  if (!(await requireGroup(ctx, 'دوز'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < 1800000) {
    await ctx.reply('⏳ یک بازی دوز در حال انجام است. لطفاً صبر کنید تا تمام شود.');
    return;
  }

  const mode = getTttMode('classic');
  const session: TttSession = {
    chatId,
    messageId: 0,
    mode,
    board: createTttBoard(mode.rows, mode.cols),
    playerX: null,
    playerO: null,
    currentTurn: 'X',
    status: 'choosing',
    winnerId: null,
    winLine: [],
    createdAt: Date.now(),
  };
  sessions.set(key, session);

  const messageId = await sendGameMessage(ctx, key, buildGameText(session), {
    parse_mode: 'Markdown',
    ...buildGameKeyboard(session),
  });
  if (typeof messageId === 'number') session.messageId = messageId;
}

// ─── Action Handler ──────────────────────────
export async function handleTicTacToeAction(ctx: Context) {
  const action = (ctx.callbackQuery as any).data as string;
  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);
  const session = sessions.get(key);

  if (!session) {
    await ctx.answerCbQuery('⏰ بازی منقضی شده یا وجود ندارد.');
    return;
  }

  const userId = ctx.from!.id;

  // ── انتخاب حالت ──
  if (action.startsWith('ttt_mode_')) {
    const modeKey = action.replace('ttt_mode_', '');
    if (modeKey === 'menu') {
      session.status = 'choosing';
      session.playerX = null;
      session.playerO = null;
      session.winLine = [];
      session.board = createTttBoard(session.mode.rows, session.mode.cols);
      await reopenTttBoard(ctx, key, session);
      await ctx.answerCbQuery('🎲 حالت بازی را انتخاب کنید.');
      await updateGameMessage(ctx, session);
      return;
    }

    const mode = getTttMode(modeKey);
    session.mode = mode;
    session.board = createTttBoard(mode.rows, mode.cols);
    session.playerX = null;
    session.playerO = null;
    session.currentTurn = 'X';
    session.winnerId = null;
    session.winLine = [];
    session.status = 'waiting';

    // آغازگر بازی به‌صورت خودکار بازیکن اول (❌) می‌شود
    if (!session.playerX) {
      session.playerX = {
        id: userId,
        name: ctx.from!.first_name || 'بازیکن ۱',
        mark: 'X',
      };
    }

    await ctx.answerCbQuery(`🎯 حالت: ${mode.label}`);
    await updateGameMessage(ctx, session);
    return;
  }

  // ── پیوستن ──
  if (action === 'ttt_join') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }

    if (!session.playerX) {
      session.playerX = {
        id: userId,
        name: ctx.from!.first_name || 'بازیکن ۱',
        mark: 'X',
      };
      await ctx.answerCbQuery('🎮 به بازی پیوستی! منتظر بازیکن دوم باشید.');
      await updateGameMessage(ctx, session);
      return;
    }

    if (session.playerX.id === userId) {
      await ctx.answerCbQuery('شما بازیکن اول هستید؛ صبر کنید تا نفر دوم بیاید.');
      return;
    }

    if (session.playerO) {
      await ctx.answerCbQuery(
        session.playerO.id === userId
          ? 'شما قبلاً پیوسته‌اید!'
          : '❌ این بازی دو نفره است — ظرفیت پر شده!'
      );
      return;
    }

    session.playerO = {
      id: userId,
      name: ctx.from!.first_name || 'بازیکن ۲',
      mark: 'O',
    };

    await ctx.answerCbQuery('🎮 به بازی پیوستی! شروع‌کننده بازی را استارت کند.');
    await updateGameMessage(ctx, session);
    return;
  }

  // ── شروع بازی ──
  if (action === 'ttt_start') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (!session.playerX || session.playerX.id !== userId) {
      await ctx.answerCbQuery('❌ فقط شروع‌کننده بازی می‌تواند بازی را استارت بزند.');
      return;
    }
    if (!session.playerO) {
      await ctx.answerCbQuery('❌ برای شروع بازی باید بازیکن دوم بپیوندد!');
      return;
    }

    session.status = 'playing';
    session.currentTurn = 'X';

    await ctx.answerCbQuery('▶️ بازی شروع شد!');
    await updateGameMessage(ctx, session);
    return;
  }

  // ── لغو ──
  if (action === 'ttt_cancel') {
    if (
      session.playerX?.id !== userId &&
      session.playerO?.id !== userId &&
      session.status !== 'choosing'
    ) {
      await ctx.answerCbQuery('❌ فقط بازیکنان می‌توانند بازی را لغو کنند.');
      return;
    }
    sessions.delete(key);
    void purgeGameMessages(ctx.telegram, key, GAME_CANCEL_PURGE_DELAY_MS);
    await ctx.answerCbQuery('بازی لغو شد.');
    try {
      await ctx.editMessageText('❌ بازی دوز لغو شد.');
    } catch {}
    return;
  }

  // ── بازی جدید ──
  if (action === 'ttt_new') {
    session.playerX = null;
    session.playerO = null;
    session.currentTurn = 'X';
    session.status = 'waiting';
    session.winnerId = null;
    session.winLine = [];
    session.board = createTttBoard(session.mode.rows, session.mode.cols);
    await reopenTttBoard(ctx, key, session);

    await ctx.answerCbQuery('🔄 بازی جدید آماده شد — منتظر بازیکن!');
    await updateGameMessage(ctx, session);
    return;
  }

  // ── کلیک روی خانهٔ پرشده ──
  if (action.startsWith('ttt_open_')) {
    await ctx.answerCbQuery('این خانه پر است!');
    return;
  }

  // ── حرکت ──
  if (action.startsWith('ttt_move_')) {
    if (session.status !== 'playing') {
      await ctx.answerCbQuery('⏳ بازی هنوز شروع نشده!');
      return;
    }

    const parts = action.split('_');
    const row = parseInt(parts[2], 10);
    const col = parseInt(parts[3], 10);
    const { rows, cols } = session.mode;

    if (
      Number.isNaN(row) ||
      Number.isNaN(col) ||
      row < 0 ||
      row >= rows ||
      col < 0 ||
      col >= cols
    ) {
      await ctx.answerCbQuery('❌ خانهٔ نامعتبر!');
      return;
    }

    const player = session.currentTurn === 'X' ? session.playerX : session.playerO;
    if (!player) {
      await ctx.answerCbQuery('❌ بازیکنی برای نوبت فعلی نیست.');
      return;
    }
    if (player.id !== userId) {
      await ctx.answerCbQuery('⏳ نوبت شما نیست!');
      return;
    }

    if (session.board[row][col] !== null) {
      await ctx.answerCbQuery('❌ این خانه پر است!');
      return;
    }

    session.board[row][col] = session.currentTurn;

    const win = checkTttWinner(session.board, rows, cols, session.mode.winLength);
    const full = isTttBoardFull(session.board, rows, cols);

    if (win || full) {
      session.status = 'finished';
      if (win) {
        session.winLine = win.line;
        const winner = win.mark === 'X' ? session.playerX : session.playerO;
        session.winnerId = winner?.id ?? null;
      }

      await awardTttPoints(ctx, session);
      // نتیجه مدت کوتاهی روی صفحه می‌ماند، بعد پیام بازی از گروه پاک می‌شود
      void purgeGameMessages(ctx.telegram, key, GAME_RESULT_PURGE_DELAY_MS);
      await ctx.answerCbQuery(win ? '🏆 بازی تمام شد!' : '🤝 مساوی!');
      await updateGameMessage(ctx, session);
      return;
    }

    session.currentTurn = session.currentTurn === 'X' ? 'O' : 'X';
    await ctx.answerCbQuery();
    await updateGameMessage(ctx, session);
  }
}

async function awardTttPoints(ctx: Context, session: TttSession) {
  const botId = (ctx as any).botId;

  const players = [session.playerX, session.playerO].filter(Boolean) as TttPlayer[];
  for (const player of players) {
    const amount =
      session.winnerId === null
        ? 10
        : session.winnerId === player.id
        ? session.mode.points
        : 0;
    if (amount <= 0) continue;

    try {
      const user = await prisma.user.findFirst({
        where: { telegramId: BigInt(player.id), botId },
      });
      if (!user) continue;

      await prisma.user.update({
        where: { id: user.id },
        data: { points: { increment: amount } },
      });
      await prisma.pointTransaction.create({
        data: {
          userId: user.id,
          amount,
          type: 'BONUS',
          description:
            session.winnerId === null ? 'بازی دوز — مساوی' : 'بازی دوز — برنده',
        },
      });
    } catch {}
  }
}

/**
 * تختهٔ بازی قبلی یا پاک شده یا در نوبت پاک شدن است؛ برای «دوز» تازه یک پیام
 * تازه در گروه می‌فرستد و همان پیام را به عنوان تختهٔ فعلی ثبت می‌کند.
 */
async function reopenTttBoard(ctx: Context, key: string, session: TttSession): Promise<void> {
  session.createdAt = Date.now();
  const messageId = await sendGameMessage(ctx, key, buildGameText(session), {
    parse_mode: 'Markdown',
    ...buildGameKeyboard(session),
  });
  if (typeof messageId === 'number') session.messageId = messageId;
}

async function updateGameMessage(ctx: Context, session: TttSession) {
  try {
    if (session.messageId > 0) {
      await ctx.telegram.editMessageText(
        String(session.chatId),
        session.messageId,
        undefined,
        buildGameText(session),
        { parse_mode: 'Markdown', ...buildGameKeyboard(session) }
      );
      return;
    }
    await ctx.editMessageText(buildGameText(session), {
      parse_mode: 'Markdown',
      ...buildGameKeyboard(session),
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
