import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { findUserByCtx } from '../../lib/user.js';
import { requireGroup, checkGameChannelJoin } from './utils.js';

// ─── Types ───────────────────────────────────
type Cell = 'X' | 'O' | null;
type Board = Cell[][];

interface TttSession {
  chatId: number;
  messageId: number;
  playerX: { id: number; name: string };
  playerO: { id: number; name: string } | null;
  currentTurn: 'X' | 'O';
  board: Board;
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
}

const sessions = new Map<string, TttSession>();

// صفحه: ۶ ستون افقی × ۷ ردیف عمودی — برنده: ۵ مهره پشت سر هم
const ROWS = 7;
const COLS = 6;
const WIN_LENGTH = 5;

function sessionKey(chatId: number): string {
  return `ttt:${chatId}`;
}

function createEmptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
}

function renderBoard(board: Board): string {
  const emojis: Record<string, string> = { X: '❌', O: '⭕', null: '⬜' };
  return board
    .map((row) => row.map((cell) => emojis[cell || 'null']).join(''))
    .join('\n');
}

function checkWinner(board: Board): Cell {
  const directions: [number, number][] = [
    [0, 1],   // افقی
    [1, 0],   // عمودی
    [1, 1],   // مورب
    [1, -1],  // مورب معکوس
  ];

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (!cell) continue;

      for (const [dr, dc] of directions) {
        let count = 0;
        for (let k = 0; k < WIN_LENGTH; k++) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
          if (board[nr][nc] !== cell) break;
          count++;
        }
        if (count === WIN_LENGTH) return cell;
      }
    }
  }

  return null;
}

function isBoardFull(board: Board): boolean {
  return board.every((row) => row.every((cell) => cell !== null));
}

function buildGameKeyboard(session: TttSession): any {
  if (session.status === 'waiting') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🎮 پیوستن به بازی', 'ttt_join')],
      [Markup.button.callback('▶️ شروع بازی', 'ttt_start')],
      [Markup.button.callback('❌ لغو', 'ttt_cancel')],
    ]);
  }

  const buttons = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const cell = session.board[r][c];
      const label = cell === 'X' ? '❌' : cell === 'O' ? '⭕' : '⬜';
      const disabled = cell !== null || session.status === 'finished';
      row.push(
        Markup.button.callback(
          label,
          disabled ? `ttt_disabled_${r}_${c}` : `ttt_move_${r}_${c}`
        )
      );
    }
    buttons.push(row);
  }

  if (session.status === 'finished') {
    buttons.push([Markup.button.callback('🔄 بازی جدید', 'ttt_new')]);
  } else {
    buttons.push([Markup.button.callback('❌ لغو بازی', 'ttt_cancel')]);
  }

  return Markup.inlineKeyboard(buttons);
}

function getStatusText(session: TttSession): string {
  if (session.status === 'waiting') {
    if (!session.playerO) {
      return '⏳ *منتظر بازیکن دوم...*\n' +
        `👤 ${mentionUser(session.playerX.id, session.playerX.name)} (❌) آماده است؛ نفر دوم دکمه «🎮 پیوستن به بازی» را بزند.`;
    }
    return '✅ *بازیکن دوم پیوست!*\n' +
      `🎮 ${mentionUser(session.playerX.id, session.playerX.name)} دکمه «▶️ شروع بازی» را بزنید.`;
  }

  const winner = checkWinner(session.board);
  const full = isBoardFull(session.board);

  if (winner) {
    const winnerPlayer = winner === 'X' ? session.playerX : session.playerO;
    return `🏆 *بازی تمام شد!*\n\n${winnerPlayer ? mentionUser(winnerPlayer.id, winnerPlayer.name) : winner} برنده شد!`;
  }

  if (full) {
    return '🤝 *بازی مساوی شد!*';
  }

  const currentPlayer = session.currentTurn === 'X' ? session.playerX : session.playerO;
  const symbol = session.currentTurn === 'X' ? '❌' : '⭕';
  return `🎮 *نوبت:* ${mentionUser(currentPlayer!.id, currentPlayer!.name)} ${symbol}`;
}

// ─── Start Tic Tac Toe ───────────────────────
export async function handleTicTacToe(ctx: Context) {
  if (!(await requireGroup(ctx, 'دوز'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < 300000) {
    await ctx.reply('⏳ یک بازی دوز در حال انجام است. لطفاً صبر کنید تا تمام شود.');
    return;
  }

  const fromUser = ctx.from!;
  const session: TttSession = {
    chatId,
    messageId: 0,
    playerX: { id: fromUser.id, name: fromUser.first_name || 'بازیکن' },
    playerO: null,
    currentTurn: 'X',
    board: createEmptyBoard(),
    status: 'waiting',
    createdAt: Date.now(),
  };
  sessions.set(key, session);

  const msg = await ctx.reply(
    `❌⭕ *بازی دوز*\n\n` +
    `📋 صفحه: ۶×۷ (۶ افقی، ۷ عمودی)\n` +
    `🎯 برنده: ۵ مهره پشت سر هم (افقی، عمودی یا مورب)\n\n` +
    `🎮 ${mentionUser(fromUser.id, fromUser.first_name || 'بازیکن')} (❌) بازی را شروع کرد!\n\n` +
    `📌 برای شروع، نفر دوم دکمه «🎮 پیوستن به بازی» را بزند؛ سپس شروع‌کننده «▶️ شروع بازی» را بزند.`,
    { parse_mode: 'Markdown', ...buildGameKeyboard(session) }
  );

  session.messageId = msg.message_id;
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

  // Handle disabled cells
  if (action.startsWith('ttt_disabled_')) {
    await ctx.answerCbQuery('این خانه پر است!');
    return;
  }

  // Join game
  if (action === 'ttt_join') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (userId === session.playerX.id) {
      await ctx.answerCbQuery('نفر اول باید صبر کند تا نفر دوم بپیوندد!');
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

    session.playerO = { id: userId, name: ctx.from!.first_name || 'بازیکن ۲' };

    await ctx.answerCbQuery('🎮 به بازی پیوستی! شروع‌کننده بازی را استارت کند.');
    await updateGameMessage(ctx, session);
    return;
  }

  // Start game (host only, needs the second player)
  if (action === 'ttt_start') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (userId !== session.playerX.id) {
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

  // Cancel game
  if (action === 'ttt_cancel') {
    if (userId !== session.playerX.id && userId !== session.playerO?.id) {
      await ctx.answerCbQuery('❌ فقط بازیکنان می‌توانند بازی را لغو کنند.');
      return;
    }
    sessions.delete(key);
    await ctx.answerCbQuery('بازی لغو شد.');
    try {
      await ctx.editMessageText('❌ بازی دوز لغو شد.');
    } catch {}
    return;
  }

  // New game
  if (action === 'ttt_new') {
    sessions.delete(key);
    await ctx.answerCbQuery();
    await handleTicTacToe(ctx);
    return;
  }

  // Make move
  if (action.startsWith('ttt_move_')) {
    if (session.status !== 'playing') {
      await ctx.answerCbQuery('بازی هنوز شروع نشده!');
      return;
    }

    const [, , rowStr, colStr] = action.split('_');
    const row = parseInt(rowStr);
    const col = parseInt(colStr);

    // Check if it's the player's turn
    const isPlayerX = userId === session.playerX.id;
    const isPlayerO = userId === session.playerO?.id;

    if (isPlayerX && session.currentTurn !== 'X') {
      await ctx.answerCbQuery('⏳ نوبت شما نیست! نوبت ⭕ است.');
      return;
    }
    if (isPlayerO && session.currentTurn !== 'O') {
      await ctx.answerCbQuery('⏳ نوبت شما نیست! نوبت ❌ است.');
      return;
    }
    if (!isPlayerX && !isPlayerO) {
      await ctx.answerCbQuery('❌ شما بازیکن این بازی نیستید!');
      return;
    }

    // Check if cell is empty
    if (session.board[row][col] !== null) {
      await ctx.answerCbQuery('❌ این خانه پر است!');
      return;
    }

    // Make the move
    session.board[row][col] = session.currentTurn;

    // Check for winner
    const winner = checkWinner(session.board);
    const full = isBoardFull(session.board);

    if (winner || full) {
      session.status = 'finished';

      // Award points to winner
      if (winner) {
        const winnerPlayer = winner === 'X' ? session.playerX : session.playerO;
        if (winnerPlayer) {
          try {
            const user = await prisma.user.findFirst({
              where: { telegramId: BigInt(winnerPlayer.id), botId: (ctx as any).botId },
            });
            if (user) {
              const rewardPoints = 25;
              await prisma.user.update({
                where: { id: user.id },
                data: { points: { increment: rewardPoints } },
              });
              await prisma.pointTransaction.create({
                data: {
                  userId: user.id,
                  amount: rewardPoints,
                  type: 'BONUS',
                  description: `بازی دوز — برنده`,
                },
              });
            }
          } catch {}
        }
      }

      await ctx.answerCbQuery(winner ? '🏆 بازی تمام شد!' : '🤝 مساوی!');
      await updateGameMessage(ctx, session);
      return;
    }

    // Switch turn
    session.currentTurn = session.currentTurn === 'X' ? 'O' : 'X';
    await ctx.answerCbQuery();
    await updateGameMessage(ctx, session);
  }
}

async function updateGameMessage(ctx: Context, session: TttSession) {
  const statusText = getStatusText(session);
  const boardStr = renderBoard(session.board);

  const text =
    `❌⭕ *بازی دوز*\n\n` +
    `👤 ${mentionUser(session.playerX.id, session.playerX.name)} — ❌\n` +
    `👤 ${session.playerO ? mentionUser(session.playerO.id, session.playerO.name) : '...'} — ⭕\n\n` +
    `${boardStr}\n\n` +
    `${statusText}`;

  try {
    await ctx.editMessageText(text, {
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
    if (now - session.createdAt > 600000) {
      sessions.delete(key);
    }
  }
}, 60000);
