import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { findUserByCtx } from '../../lib/user.js';
import { requireGroup, checkGameChannelJoin } from './utils.js';

// ─── Types ───────────────────────────────────
interface MsCell {
  isBomb: boolean;
  revealed: boolean;
  adjacentBombs: number;
}

interface MsSession {
  chatId: number;
  messageId: number;
  board: MsCell[][];
  size: number;
  bombCount: number;
  players: Map<number, { id: number; name: string; lives: number }>;
  turnOrder: number[];
  currentTurnIndex: number;
  revealedCount: number;
  status: 'waiting' | 'playing' | 'finished';
  winner: { id: number; name: string } | null;
  createdAt: number;
}

const sessions = new Map<string, MsSession>();

function sessionKey(chatId: number): string {
  return `ms:${chatId}`;
}

function createBoard(size: number, bombCount: number): MsCell[][] {
  const board: MsCell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({
      isBomb: false,
      revealed: false,
      adjacentBombs: 0,
    }))
  );

  // Place bombs randomly
  let placed = 0;
  while (placed < bombCount) {
    const r = Math.floor(Math.random() * size);
    const c = Math.floor(Math.random() * size);
    if (!board[r][c].isBomb) {
      board[r][c].isBomb = true;
      placed++;
    }
  }

  // Calculate adjacent bombs
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c].isBomb) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < size && nc >= 0 && nc < size && board[nr][nc].isBomb) {
            count++;
          }
        }
      }
      board[r][c].adjacentBombs = count;
    }
  }

  return board;
}

function renderMsBoard(board: MsCell[][]): string {
  const numberEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];

  return board
    .map((row) =>
      row
        .map((cell) => {
          if (!cell.revealed) return '🟦';
          if (cell.isBomb) return '💣';
          return numberEmojis[cell.adjacentBombs] || '⬜';
        })
        .join('')
    )
    .join('\n');
}

function buildMsKeyboard(session: MsSession, showAll: boolean = false): any {
  if (session.status === 'waiting') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🎮 پیوستن به بازی', 'ms_join')],
      [Markup.button.callback('❌ لغو', 'ms_cancel')],
    ]);
  }

  if (session.status === 'finished') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🔄 بازی جدید', 'ms_new')],
      [Markup.button.callback('🔙 منوی بازی', 'games')],
    ]);
  }

  const buttons = [];
  for (let r = 0; r < session.size; r++) {
    const row = [];
    for (let c = 0; c < session.size; c++) {
      const cell = session.board[r][c];
      let label: string;
      if (showAll && cell.isBomb) {
        label = '💣';
      } else if (cell.revealed) {
        if (cell.isBomb) label = '💥';
        else label = cell.adjacentBombs > 0 ? String(cell.adjacentBombs) : '✅';
      } else {
        label = '🟦';
      }
      row.push(
        Markup.button.callback(
          label,
          cell.revealed ? `ms_revealed_${r}_${c}` : `ms_pick_${r}_${c}`
        )
      );
    }
    buttons.push(row);
  }

  buttons.push([Markup.button.callback('❌ لغو بازی', 'ms_cancel')]);

  return Markup.inlineKeyboard(buttons);
}

function getCurrentPlayer(session: MsSession): { id: number; name: string; lives: number } | null {
  if (session.turnOrder.length === 0) return null;
  const playerId = session.turnOrder[session.currentTurnIndex % session.turnOrder.length];
  return session.players.get(playerId) || null;
}

// ─── Start Minesweeper ───────────────────────
export async function handleMinesweeper(ctx: Context) {
  if (!(await requireGroup(ctx, 'مین‌روب'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < 300000) {
    await ctx.reply('⏳ یک بازی مین‌یاب در حال انجام است. لطفاً صبر کنید تا تمام شود.');
    return;
  }

  const fromUser = ctx.from!;
  const session: MsSession = {
    chatId,
    messageId: 0,
    board: createBoard(20, 50),
    size: 20,
    bombCount: 50,
    players: new Map(),
    turnOrder: [],
    currentTurnIndex: 0,
    revealedCount: 0,
    status: 'waiting',
    winner: null,
    createdAt: Date.now(),
  };

  session.players.set(fromUser.id, {
    id: fromUser.id,
    name: fromUser.first_name || 'بازیکن',
    lives: 3,
  });
  session.turnOrder.push(fromUser.id);
  sessions.set(key, session);

  const msg = await ctx.reply(
    `💣 *بازی مین‌روب*\n\n` +
    `🎮 ${mentionUser(fromUser.id, fromUser.first_name || 'بازیکن')} بازی را شروع کرد!\n\n` +
    `📏 اندازه صفحه: ۵×۵\n` +
    `💣 تعداد بمب: ۵\n` +
    `❤️ جان هر بازیکن: ۳\n\n` +
    `🎯 *قوانین:*\n` +
    `• هر نوبت یک خانه را باز کنید\n` +
    `• اگر بمب پیدا کنید، یک جان از دست می‌دهید\n` +
    `• اگر همه خانه‌های امن را باز کنید، برنده هستید!\n` +
    `• آخرین نفر با جان = برنده\n\n` +
    `برای پیوستن، دکمه زیر را بزنید:`,
    { parse_mode: 'Markdown', ...buildMsKeyboard(session) }
  );

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

  if (action === 'ms_cancel') {
    if (!session.players.has(userId)) {
      await ctx.answerCbQuery('❌ شما بازیکن این بازی نیستید.');
      return;
    }
    sessions.delete(key);
    await ctx.answerCbQuery('بازی لغو شد.');
    try {
      await ctx.editMessageText('❌ بازی مین‌یاب لغو شد.');
    } catch {}
    return;
  }

  if (action === 'ms_new') {
    sessions.delete(key);
    await ctx.answerCbQuery();
    await handleMinesweeper(ctx);
    return;
  }

  if (action === 'ms_join') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (session.players.has(userId)) {
      await ctx.answerCbQuery('شما قبلاً پیوسته‌اید!');
      return;
    }
    if (session.players.size >= 6) {
      await ctx.answerCbQuery('❌ حداکثر ۶ بازیکن!');
      return;
    }

    session.players.set(userId, {
      id: userId,
      name: ctx.from!.first_name || 'بازیکن',
      lives: 3,
    });
    session.turnOrder.push(userId);

    await ctx.answerCbQuery('🎮 به بازی پیوستی!');
    await updateMsMessage(ctx, session);
    return;
  }

  if (action.startsWith('ms_revealed_')) {
    await ctx.answerCbQuery('این خانه قبلاً باز شده!');
    return;
  }

  if (action.startsWith('ms_pick_')) {
    if (session.status === 'waiting') {
      // Start the game if enough players
      if (session.players.size < 1) {
        await ctx.answerCbQuery('❌ حداقل ۱ بازیکن نیاز است!');
        return;
      }
      session.status = 'playing';
    }

    if (session.status !== 'playing') {
      await ctx.answerCbQuery('بازی تمام شده!');
      return;
    }

    // Check if it's the player's turn
    const currentPlayer = getCurrentPlayer(session);
    if (!currentPlayer || currentPlayer.id !== userId) {
      await ctx.answerCbQuery(`⏳ نوبت ${currentPlayer?.name || 'بازیکن'} است!`);
      return;
    }

    const [, , rowStr, colStr] = action.split('_');
    const row = parseInt(rowStr);
    const col = parseInt(colStr);

    if (row < 0 || row >= session.size || col < 0 || col >= session.size) {
      await ctx.answerCbQuery('❌ خانه نامعتبر!');
      return;
    }

    const cell = session.board[row][col];
    if (cell.revealed) {
      await ctx.answerCbQuery('❌ این خانه قبلاً باز شده!');
      return;
    }

    cell.revealed = true;
    session.revealedCount++;

    if (cell.isBomb) {
      // Hit a bomb!
      const player = session.players.get(userId)!;
      player.lives--;

      if (player.lives <= 0) {
        // Player eliminated
        session.players.delete(userId);
        session.turnOrder = session.turnOrder.filter((id) => id !== userId);

        if (session.players.size <= 1) {
          // Game over
          session.status = 'finished';
          const winner = session.players.values().next().value;
          if (winner) {
            session.winner = { id: winner.id, name: winner.name };
            await awardMsWinner(ctx, winner.id, session);
          }
          await ctx.answerCbQuery('💥 بمب! بازی تمام شد!');
          await updateMsMessage(ctx, session, true);
          return;
        }
      }

      await ctx.answerCbQuery(`💥 بمب! ${player.lives} جان باقی‌مانده.`);
    } else {
      // Safe cell
      const safeCells = session.size * session.size - session.bombCount;
      if (session.revealedCount >= safeCells) {
        // All safe cells revealed!
        session.status = 'finished';
        session.winner = { id: userId, name: currentPlayer.name };
        await awardMsWinner(ctx, userId, session);
        await ctx.answerCbQuery('🎉 همه خانه‌های امن را باز کردی! برنده‌ای!');
        await updateMsMessage(ctx, session, true);
        return;
      }
      await ctx.answerCbQuery('✅ امن!');
    }

    // Next turn
    if (session.turnOrder.length > 0) {
      session.currentTurnIndex = (session.currentTurnIndex + 1) % session.turnOrder.length;
    }

    await updateMsMessage(ctx, session);
  }
}

async function awardMsWinner(ctx: Context, winnerId: number, session: MsSession) {
  try {
    const user = await prisma.user.findFirst({
      where: { telegramId: BigInt(winnerId), botId: (ctx as any).botId },
    });
    if (user) {
      const rewardPoints = 30;
      await prisma.user.update({
        where: { id: user.id },
        data: { points: { increment: rewardPoints } },
      });
      await prisma.pointTransaction.create({
        data: {
          userId: user.id,
          amount: rewardPoints,
          type: 'BONUS',
          description: 'بازی مین‌یاب — برنده',
        },
      });
    }
  } catch {}
}

async function updateMsMessage(ctx: Context, session: MsSession, showBombs: boolean = false) {
  const boardStr = renderMsBoard(session.board);
  const currentPlayer = getCurrentPlayer(session);

  let statusText: string;
  if (session.status === 'waiting') {
    statusText = `👥 *بازیکنان:* ${session.players.size}\nبرای شروع، دکمه پیوستن را بزنید.`;
  } else if (session.status === 'finished') {
    statusText = session.winner
      ? `🏆 *برنده:* ${mentionUser(session.winner.id, session.winner.name)}\n🎉 ۳۰ امتیاز دریافت شد!`
      : '🏁 بازی تمام شد!';
  } else {
    const playerLives = currentPlayer
      ? `❤️ ${currentPlayer.lives}`
      : '';
    statusText = `🎯 نوبت: ${currentPlayer ? mentionUser(currentPlayer.id, currentPlayer.name) : '...'} ${playerLives}`;
  }

  const playersList = Array.from(session.players.values())
    .map((p) => `${mentionUser(p.id, p.name)} ${'❤️'.repeat(p.lives)}${'🖤'.repeat(3 - p.lives)}`)
    .join('\n');

  const text =
    `💣 *بازی مین‌روب*\n\n` +
    `${boardStr}\n\n` +
    `👥 *بازیکنان:*\n${playersList || '...'}\n\n` +
    `${statusText}`;

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...buildMsKeyboard(session, showBombs),
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
