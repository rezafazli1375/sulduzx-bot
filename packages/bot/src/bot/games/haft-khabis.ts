import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { getBotId } from '../../lib/bot-context.js';
import { findUserByCtx } from '../../lib/user.js';
import { requireGroup, checkGameChannelJoin } from './utils.js';

// ─── Types ───────────────────────────────────
interface HkQuestion {
  id: number;
  text: string;
  options: string[];
  correctIndex: number;
}

interface HkPlayer {
  id: number;
  name: string;
  round: number;
  lives: number;
  isEliminated: boolean;
}

interface HkSession {
  chatId: number;
  messageId: number;
  players: Map<number, HkPlayer>;
  questions: HkQuestion[];
  currentQuestion: number;
  status: 'waiting' | 'playing' | 'answering' | 'finished';
  winner: HkPlayer | null;
  answeringPlayer: number | null;
  createdAt: number;
}

const sessions = new Map<string, HkSession>();

function sessionKey(chatId: number): string {
  return `hk:${chatId}`;
}

// ─── Default questions (fallback) ────────────
const defaultQuestions: HkQuestion[] = [
  {
    id: 1,
    text: 'پایتخت ایران کجاست؟',
    options: ['اصفهان', 'تهران', 'شیراز', 'تبریز'],
    correctIndex: 1,
  },
  {
    id: 2,
    text: 'بزرگ‌ترین اقیانوس جهان کدام است؟',
    options: ['اطلس', 'هند', 'آرام', 'منجمد شمالی'],
    correctIndex: 2,
  },
  {
    id: 3,
    text: 'کدام سیاره به خورشید نزدیک‌تر است؟',
    options: ['زهره', 'زمین', 'عطارد', 'مریخ'],
    correctIndex: 2,
  },
  {
    id: 4,
    text: 'حاصل ۱۵ × ۱۲ چند است؟',
    options: ['۱۵۰', '۱۸۰', '۱۶۰', '۱۷۰'],
    correctIndex: 1,
  },
  {
    id: 5,
    text: 'بلندترین قله جهان کدام است؟',
    options: ['K2', 'کانچنجونگا', 'اورست', 'لوتسه'],
    correctIndex: 2,
  },
  {
    id: 6,
    text: 'کدام عنصر شیمیایی نماد Au دارد؟',
    options: ['نقره', 'طلا', 'مس', 'آهن'],
    correctIndex: 1,
  },
  {
    id: 7,
    text: 'جنگ جهانی دوم در چه سالی پایان یافت؟',
    options: ['۱۹۴۳', '۱۹۴۴', '۱۹۴۵', '۱۹۴۶'],
    correctIndex: 2,
  },
  {
    id: 8,
    text: 'کدام کشور بیشترین جمعیت را دارد؟',
    options: ['آمریکا', 'هند', 'چین', 'اندونزی'],
    correctIndex: 1,
  },
  {
    id: 9,
    text: 'سریع‌ترین حیوان روی زمین کدام است؟',
    options: ['شیر', 'یوزپلنگ', 'عقاب', 'اسب'],
    correctIndex: 1,
  },
  {
    id: 10,
    text: 'کدام ویتامین از نور خورشید حاصل می‌شود؟',
    options: ['ویتامین A', 'ویتامین B', 'ویتامین C', 'ویتامین D'],
    correctIndex: 3,
  },
  {
    id: 11,
    text: 'زبان رسمی برزیل چیست؟',
    options: ['اسپانیایی', 'پرتغالی', 'انگلیسی', 'فرانسوی'],
    correctIndex: 1,
  },
  {
    id: 12,
    text: 'کدام رود از ایران عبور نمی‌کند؟',
    options: ['کارون', 'زاینده‌رود', 'نیلابس', 'هیرمند'],
    correctIndex: 2,
  },
  {
    id: 13,
    text: 'مخترع تلفن کیست؟',
    options: ['ادیسون', 'تسلا', 'بل', 'مارکونی'],
    correctIndex: 2,
  },
  {
    id: 14,
    text: 'کدام سیاره حلقه دارد؟',
    options: ['مریخ', 'مشتری', 'زحل', 'اورانوس'],
    correctIndex: 2,
  },
  {
    id: 15,
    text: 'واحد اندازه‌گیری نیرو چیست؟',
    options: ['وات', 'ژول', 'نیوتن', 'پاسکال'],
    correctIndex: 2,
  },
];

async function loadQuestions(botId: number, count: number = 7): Promise<HkQuestion[]> {
  try {
    const dbQuestions = await prisma.gameQuestion.findMany({
      where: { gameType: 'HAFT_KHABIS', isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    if (dbQuestions.length >= count) {
      // Shuffle and pick 7
      const shuffled = [...dbQuestions].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, count).map((q) => ({
        id: q.id,
        text: q.text,
        options: [q.optionA || '', q.optionB || '', q.optionC || '', q.optionD || ''].filter(Boolean),
        correctIndex: ['A', 'B', 'C', 'D'].indexOf(q.answer),
      }));
    }
  } catch {}

  // Fallback to defaults
  const shuffled = [...defaultQuestions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function buildHkKeyboard(session: HkSession): any {
  if (session.status === 'waiting') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🎮 پیوستن به بازی', 'hk_join')],
      [Markup.button.callback('🚀 شروع بازی', 'hk_start')],
      [Markup.button.callback('❌ لغو', 'hk_cancel')],
    ]);
  }

  if (session.status === 'answering' && session.answeringPlayer) {
    const question = session.questions[session.currentQuestion];
    if (!question) return Markup.inlineKeyboard([]);

    const buttons = question.options.map((opt, idx) => [
      Markup.button.callback(`${['🅰️', '🅱️', '🅲', '🅳'][idx]} ${opt}`, `hk_answer_${idx}`),
    ]);

    return Markup.inlineKeyboard(buttons);
  }

  if (session.status === 'finished') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🔄 بازی جدید', 'hk_new')],
      [Markup.button.callback('🔙 منوی بازی', 'games')],
    ]);
  }

  return Markup.inlineKeyboard([]);
}

// ─── Start Haft Khabis ───────────────────────
export async function handleHaftKhabis(ctx: Context) {
  if (!(await requireGroup(ctx, 'هفت خبیث'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < 600000) {
    await ctx.reply('⏳ یک بازی هفت خبیث در حال انجام است. لطفاً صبر کنید تا تمام شود.');
    return;
  }

  const fromUser = ctx.from!;
  const botId = getBotId(ctx);
  const questions = await loadQuestions(botId);

  const session: HkSession = {
    chatId,
    messageId: 0,
    players: new Map(),
    questions,
    currentQuestion: 0,
    status: 'waiting',
    winner: null,
    answeringPlayer: null,
    createdAt: Date.now(),
  };

  session.players.set(fromUser.id, {
    id: fromUser.id,
    name: fromUser.first_name || 'بازیکن',
    round: 1,
    lives: 1,
    isEliminated: false,
  });
  sessions.set(key, session);

  const msg = await ctx.reply(
    `😈 *هفت خبیث*\n\n` +
    `🎮 ${mentionUser(fromUser.id, fromUser.first_name || 'بازیکن')} بازی را شروع کرد!\n\n` +
    `📋 *قوانین:*\n` +
    `• ۷ سوال سخت و چالشی\n` +
    `• هر بازیکن نوبتی جواب می‌دهد\n` +
    `• جواب اشتباه = حذف از بازی\n` +
    `• آخرین نفر باقی‌مانده = برنده!\n` +
    `• برنده ۵۰ امتیاز می‌گیرد\n\n` +
    `👥 بازیکنان: ۱\n` +
    `حداقل ۲ بازیکن نیاز است.`,
    { parse_mode: 'Markdown', ...buildHkKeyboard(session) }
  );

  session.messageId = msg.message_id;
}

// ─── Action Handler ──────────────────────────
export async function handleHaftKhabisAction(ctx: Context) {
  const action = (ctx.callbackQuery as any).data as string;
  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);
  const session = sessions.get(key);

  if (!session) {
    await ctx.answerCbQuery('⏰ بازی منقضی شده یا وجود ندارد.');
    return;
  }

  const userId = ctx.from!.id;

  if (action === 'hk_cancel') {
    if (!session.players.has(userId)) {
      await ctx.answerCbQuery('❌ شما بازیکن این بازی نیستید.');
      return;
    }
    sessions.delete(key);
    await ctx.answerCbQuery('بازی لغو شد.');
    try {
      await ctx.editMessageText('❌ بازی هفت خبیث لغو شد.');
    } catch {}
    return;
  }

  if (action === 'hk_new') {
    sessions.delete(key);
    await ctx.answerCbQuery();
    await handleHaftKhabis(ctx);
    return;
  }

  if (action === 'hk_join') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (session.players.has(userId)) {
      await ctx.answerCbQuery('شما قبلاً پیوسته‌اید!');
      return;
    }
    if (session.players.size >= 8) {
      await ctx.answerCbQuery('❌ حداکثر ۸ بازیکن!');
      return;
    }

    session.players.set(userId, {
      id: userId,
      name: ctx.from!.first_name || 'بازیکن',
      round: 1,
      lives: 1,
      isEliminated: false,
    });

    await ctx.answerCbQuery('🎮 به بازی پیوستی!');
    await updateHkMessage(ctx, session);
    return;
  }

  if (action === 'hk_start') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (session.players.size < 2) {
      await ctx.answerCbQuery('❌ حداقل ۲ بازیکن نیاز است!');
      return;
    }

    session.status = 'answering';
    const firstPlayer = session.players.values().next().value!;
    session.answeringPlayer = firstPlayer.id;

    await ctx.answerCbQuery('🎮 بازی شروع شد!');
    await updateHkMessage(ctx, session);
    return;
  }

  if (action.startsWith('hk_answer_')) {
    if (session.status !== 'answering') {
      await ctx.answerCbQuery('⏳ لطفاً صبر کنید...');
      return;
    }

    if (userId !== session.answeringPlayer) {
      const currentPlayer = session.players.get(session.answeringPlayer!);
      await ctx.answerCbQuery(`⏳ نوبت ${currentPlayer?.name || 'بازیکن'} است!`);
      return;
    }

    const [, , answerIdx] = action.split('_');
    const selectedAnswer = parseInt(answerIdx);
    const question = session.questions[session.currentQuestion];

    if (!question) {
      session.status = 'finished';
      await ctx.answerCbQuery();
      await updateHkMessage(ctx, session);
      return;
    }

    const isCorrect = selectedAnswer === question.correctIndex;
    const player = session.players.get(userId)!;

    if (!isCorrect) {
      // Player eliminated
      player.isEliminated = true;
      session.players.delete(userId);

      await ctx.answerCbQuery('❌ جواب اشتباه! حذف شدید.');
    } else {
      player.round++;
      await ctx.answerCbQuery('✅ درست!');
    }

    // Check if game is over
    const activePlayers = Array.from(session.players.values()).filter((p) => !p.isEliminated);

    if (activePlayers.length <= 1) {
      session.status = 'finished';
      if (activePlayers.length === 1) {
        session.winner = activePlayers[0];
        await awardHkWinner(ctx, session.winner.id, session);
      }
      await updateHkMessage(ctx, session);
      return;
    }

    // Check if all 7 rounds are done
    if (session.currentQuestion >= session.questions.length - 1) {
      session.status = 'finished';
      // Winner is the player with highest round
      const sorted = activePlayers.sort((a, b) => b.round - a.round);
      session.winner = sorted[0];
      await awardHkWinner(ctx, session.winner.id, session);
      await updateHkMessage(ctx, session);
      return;
    }

    // Next question
    session.currentQuestion++;

    // Next player (round-robin among active players)
    const activeIds = activePlayers.map((p) => p.id);
    const currentIdx = activeIds.indexOf(userId);
    const nextIdx = (currentIdx + 1) % activeIds.length;
    session.answeringPlayer = activeIds[nextIdx];

    await updateHkMessage(ctx, session);
  }
}

async function awardHkWinner(ctx: Context, winnerId: number, session: HkSession) {
  try {
    const user = await prisma.user.findFirst({
      where: { telegramId: BigInt(winnerId), botId: (ctx as any).botId },
    });
    if (user) {
      const rewardPoints = 50;
      await prisma.user.update({
        where: { id: user.id },
        data: { points: { increment: rewardPoints } },
      });
      await prisma.pointTransaction.create({
        data: {
          userId: user.id,
          amount: rewardPoints,
          type: 'BONUS',
          description: 'بازی هفت خبیث — برنده',
        },
      });
    }
  } catch {}
}

async function updateHkMessage(ctx: Context, session: HkSession) {
  const question = session.questions[session.currentQuestion];
  const currentPlayer = session.players.get(session.answeringPlayer!);

  let statusText: string;
  if (session.status === 'waiting') {
    statusText = `👥 *بازیکنان:* ${session.players.size}\nحداقل ۲ بازیکن نیاز است.`;
  } else if (session.status === 'finished') {
    statusText = session.winner
      ? `🏆 *برنده:* ${mentionUser(session.winner.id, session.winner.name)}\n🎉 ۵۰ امتیاز دریافت شد!`
      : '🏁 بازی تمام شد!';
  } else if (session.status === 'answering') {
    statusText = `🎯 نوبت: ${currentPlayer ? mentionUser(currentPlayer.id, currentPlayer.name) : '...'}\n` +
      `📊 سوال ${session.currentQuestion + 1} از ${session.questions.length}`;
  } else {
    statusText = '';
  }

  const playersList = Array.from(session.players.values())
    .map((p) => {
      const status = p.isEliminated ? '❌' : `مرحله ${p.round}`;
      return `${mentionUser(p.id, p.name)} — ${status}`;
    })
    .join('\n');

  let questionText = '';
  if (session.status === 'answering' && question) {
    questionText = `\n\n❓ *سوال:*\n${question.text}\n\n` +
      question.options.map((opt, idx) => `${['🅰️', '🅱️', '🅲', '🅳'][idx]} ${opt}`).join('\n');
  }

  const text =
    `😈 *هفت خبیث*\n\n` +
    `👥 *بازیکنان:*\n${playersList || '...'}\n\n` +
    `${statusText}` +
    `${questionText}`;

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...buildHkKeyboard(session),
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
    if (now - session.createdAt > 900000) {
      sessions.delete(key);
    }
  }
}, 60000);
