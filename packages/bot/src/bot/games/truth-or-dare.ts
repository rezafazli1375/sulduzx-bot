import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { getBotId } from '../../lib/bot-context.js';
import { findUserByCtx } from '../../lib/user.js';
import { requireGroup, checkGameChannelJoin } from './utils.js';

// ─── Types ───────────────────────────────────
interface TodSession {
  chatId: bigint;
  challengerId: number;
  challengedId: number | null;
  challengedName: string;
  status: 'choosing' | 'answered' | 'skipped';
  choice: 'truth' | 'dare' | null;
  questionText: string;
  messageId: number | null;
  difficulty: 'easy' | 'medium' | 'hard';
  skipCount: number;
  createdAt: number;
}

const sessions = new Map<string, TodSession>();

function sessionKey(chatId: number | bigint): string {
  return `tod:${chatId}`;
}

// ─── Questions by difficulty ─────────────────
const truthQuestions = {
  easy: [
    'اسم حیوان مورد علاقه‌ت چیه؟ 🐾',
    'رنگ مورد علاقه‌ت چیه؟ 🎨',
    'غذای مورد علاقه‌ت چیه؟ 🍕',
    'آخرین فیلمی که دیدی چی بود؟ 🎬',
    'اگه می‌تونستی یک ابرقدرت داشته باشی، چی رو انتخاب می‌کردی؟ ⚡',
    'بهترین خاطره کودکی‌ت چیه؟ 👶',
    'اگه ۱ میلیارد تومن داشتی، اولین چیزی که می‌خریدی چی بود؟ 💰',
    'موسیقی مورد علاقه‌ت چیه؟ 🎵',
  ],
  medium: [
    'بزرگ‌ترین دروغی که تا حالا گفتی چی بوده؟ 🤥',
    'آخرین باری که گریه کردی کی بود و چرا؟ 😢',
    'بدترین سوتی‌ای که تا حالا دادی چی بوده؟ 😅',
    'اگه فردا آخرین روز زندگیت باشه، چیکار می‌کنی؟ 🌅',
    'رازدارترین چیزی که تا حالا به کسی نگفتی چیه؟ 🤫',
    'عجیب‌ترین خوابی که دیدی چی بوده؟ 💭',
    'بدترین تصمیمی که تا حالا گرفتی چی بوده؟ 😬',
    'اگه می‌تونستی یک روز نامرئی بشی، کجا می‌رفتی؟ 👻',
  ],
  hard: [
    'اگه می‌تونستی یک عادت بدت رو حذف کنی، کدوم رو حذف می‌کردی؟ 🚫',
    'بزرگ‌ترین ترست چیه؟ 😱',
    'اگه می‌تونستی یک چیز رو در گذشته تغییر بدی، چی رو تغییر می‌دادی؟ ⏰',
    'آخرین باری که دروغ گفتی کی بود و به کی؟ 🤥',
    'اگه مجبور بودی با یکی از اعضای گروه جزیره تنها بمونی، کی رو انتخاب می‌کردی؟ 🏝️',
    'بدترین کاری که تا حالا کردی و پشیمونی چیه؟ 😔',
    'اگه می‌دونستی ۱ سال دیگه می‌میری، چیکار می‌کردی؟ 💀',
    'بزرگ‌ترین حسرت زندگیت چیه؟ 😞',
  ],
};

const dareChallenges = {
  easy: [
    'یک سلفی خنده‌دار بگیر و بفرست تو گروه! 📸',
    'یک ویس بفرست و توش بگو "من بهترینم"! 🎤',
    '۱۰ بار بپر و بعد بگو اسم ۵ تا کشور! 🦘',
    'یک ایموجی که شبیهته رو بفرست! 😊',
    'اسم ۵ تا میوه رو در ۲۰ ثانیه بگو! 🍎',
    'یک جوک تعریف کن! 😂',
  ],
  medium: [
    'یک ویدیو ۱۰ ثانیه‌ای از خودت بگیر و بفرست! 🎬',
    'آخرین عکسی که تو گالری داری رو بفرست! 🖼️',
    'به مدت ۱ دقیقه فقط با لهجه حرف بزن! 🗣️',
    'یک استوری خنده‌دار بذار! 📱',
    '۳۰ ثانیه بدون پلک زدن به صفحه نگاه کن! 👀',
    'آخرین پیامی که تو واتساپ فرستادی رو اسکرین‌شات بگیر! 📲',
  ],
  hard: [
    'به نفر بعدی لیست مخاطبینت زنگ بزن و بگو دوستت دارم! 📞',
    'یک دقیقه چشمات رو ببند و بعد سعی کن یه خط بنویسی! ✍️',
    'یک نقاشی سریع از گربه بکش و بفرست! 🐱',
    'به مدت ۵ دقیقه فقط با ایموجی حرف بزن! 😊',
    'یک آواز ۳۰ ثانیه‌ای بخون و ویس بفرست! 🎶',
    'یک چالش TikTok انجام بده و ویدیو بفرست! 💃',
  ],
};

async function getRandomQuestion(type: 'truth' | 'dare', difficulty: 'easy' | 'medium' | 'hard', botId: number): Promise<string> {
  try {
    const questions = await prisma.gameQuestion.findMany({
      where: { gameType: 'TRUTH_OR_DARE', isActive: true, answer: type },
    });

    if (questions.length > 0) {
      const random = questions[Math.floor(Math.random() * questions.length)];
      return random.text;
    }
  } catch {}

  const pool = type === 'truth' ? truthQuestions[difficulty] : dareChallenges[difficulty];
  return pool[Math.floor(Math.random() * pool.length)];
}

function getPointsForDifficulty(difficulty: 'easy' | 'medium' | 'hard'): number {
  return difficulty === 'easy' ? 10 : difficulty === 'medium' ? 20 : 35;
}

// ─── Start Truth or Dare ─────────────────────
export async function handleTruthOrDare(ctx: Context) {
  if (!(await requireGroup(ctx, 'جرعت و حقیقت'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && Date.now() - existing.createdAt < 120000) {
    await ctx.reply('⏳ یک بازی جرعت و حقیقت در حال انجام است. لطفاً صبر کنید تا تمام شود.');
    return;
  }

  const fromUser = ctx.from!;
  const chatMembers = await getGroupMembers(ctx);

  if (chatMembers.length < 2) {
    await ctx.reply(
      '🎭 *جرعت و حقیقت*\n\n' +
      'برای شروع این بازی حداقل به *۲ نفر* نیاز دارید!\n' +
      'لطفاً اعضای بیشتری در گروه حضور داشته باشند.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const otherMembers = chatMembers.filter((m) => m.id !== fromUser.id);
  const challenged = otherMembers[Math.floor(Math.random() * otherMembers.length)];

  const session: TodSession = {
    chatId: BigInt(chatId),
    challengerId: fromUser.id,
    challengedId: challenged.id,
    challengedName: challenged.name,
    status: 'choosing',
    choice: null,
    questionText: '',
    messageId: null,
    difficulty: 'medium',
    skipCount: 0,
    createdAt: Date.now(),
  };
  sessions.set(key, session);

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('💬 حقیقت', 'tod_truth'),
      Markup.button.callback('💪 جرئت', 'tod_dare'),
    ],
    [
      Markup.button.callback('🟢 آسان', 'tod_diff_easy'),
      Markup.button.callback('🟡 متوسط', 'tod_diff_medium'),
      Markup.button.callback('🔴 سخت', 'tod_diff_hard'),
    ],
    [Markup.button.callback('❌ انصراف', 'tod_cancel')],
  ]);

  const msg = await ctx.reply(
    `🎭 *جرعت و حقیقت*\n\n` +
    `👤 ${mentionUser(fromUser.id, fromUser.first_name || 'بازیکن')} چالش می‌زنه:\n` +
    `👉 ${mentionUser(challenged.id, challenged.name)}\n\n` +
    `${mentionUser(challenged.id, challenged.name)} انتخاب کن:\n` +
    `💬 *حقیقت* — یک سوال صادقانه جواب بده\n` +
    `💪 *جرئت* — یک چالش انجام بده\n\n` +
    `🎯 *سطح سختی:* متوسط (۲۰ امتیاز)\n` +
    `⏱️ *زمان:* ۲ دقیقه`,
    { parse_mode: 'Markdown', ...keyboard }
  );

  session.messageId = msg.message_id;
}

// ─── Action Handler ──────────────────────────
export async function handleTruthOrDareAction(ctx: Context) {
  const action = (ctx.callbackQuery as any).data as string;
  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);
  const session = sessions.get(key);

  if (!session) {
    await ctx.answerCbQuery('⏰ بازی منقضی شده یا وجود ندارد.');
    try { await ctx.editMessageText('⏰ بازی جرعت و حقیقت منقضی شد. از منوی بازی‌ها دوباره شروع کنید!'); } catch {}
    return;
  }

  if (Date.now() - session.createdAt > 120000) {
    sessions.delete(key);
    await ctx.answerCbQuery('⏰ زمان بازی تمام شد.');
    try { await ctx.editMessageText('⏰ بازی جرعت و حقیقت منقضی شد.'); } catch {}
    return;
  }

  const userId = ctx.from!.id;

  // Difficulty selection
  if (action.startsWith('tod_diff_')) {
    if (userId !== session.challengedId) {
      await ctx.answerCbQuery(`❌ فقط ${session.challengedName} می‌تواند سطح سختی را انتخاب کند.`);
      return;
    }
    const difficulty = action.replace('tod_diff_', '') as 'easy' | 'medium' | 'hard';
    session.difficulty = difficulty;
    const points = getPointsForDifficulty(difficulty);
    const emoji = difficulty === 'easy' ? '🟢' : difficulty === 'medium' ? '🟡' : '🔴';
    
    await ctx.answerCbQuery(`سطح سختی: ${emoji} ${difficulty}`);
    await updateDifficultyMessage(ctx, session);
    return;
  }

  if (action === 'tod_cancel') {
    if (userId !== session.challengerId && userId !== session.challengedId) {
      await ctx.answerCbQuery('❌ فقط بازیکنان می‌توانند بازی را لغو کنند.');
      return;
    }
    sessions.delete(key);
    await ctx.answerCbQuery('بازی لغو شد.');
    try { await ctx.editMessageText('❌ بازی جرعت و حقیقت لغو شد.'); } catch {}
    return;
  }

  if (userId !== session.challengedId) {
    await ctx.answerCbQuery(`❌ فقط ${session.challengedName} می‌تواند انتخاب کند.`);
    return;
  }

  if (session.status !== 'choosing') {
    await ctx.answerCbQuery('⏳ لطفاً صبر کنید...');
    return;
  }

  const botId = getBotId(ctx);

  if (action === 'tod_truth') {
    session.choice = 'truth';
    session.status = 'answered';
    const question = await getRandomQuestion('truth', session.difficulty, botId);
    session.questionText = question;

    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(
        `🎭 *جرعت و حقیقت — حقیقت*\n\n` +
        `💬 ${mentionUser(session.challengedId!, session.challengedName)} حقیقت رو انتخاب کرد!\n\n` +
        `❓ *سوال:*\n${question}\n\n` +
        `🎯 *سطح:* ${session.difficulty === 'easy' ? '🟢 آسان' : session.difficulty === 'medium' ? '🟡 متوسط' : '🔴 سخت'}\n` +
        `💰 *امتیاز:* ${getPointsForDifficulty(session.difficulty)}\n` +
        `⏱️ *زمان:* ۲ دقیقه\n\n` +
        `_جواب بده یا رد کن!_`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ جواب دادم', 'tod_done')],
            [Markup.button.callback('⏭️ رد کردن سوال', 'tod_skip')],
            [Markup.button.callback('❌ انصراف', 'tod_cancel')],
          ]),
        }
      );
    } catch {}
  } else if (action === 'tod_dare') {
    session.choice = 'dare';
    session.status = 'answered';
    const dare = await getRandomQuestion('dare', session.difficulty, botId);
    session.questionText = dare;

    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(
        `🎭 *جرعت و حقیقت — جرئت*\n\n` +
        `💪 ${mentionUser(session.challengedId!, session.challengedName)} جرئت رو انتخاب کرد!\n\n` +
        `🔥 *چالش:*\n${dare}\n\n` +
        `🎯 *سطح:* ${session.difficulty === 'easy' ? '🟢 آسان' : session.difficulty === 'medium' ? '🟡 متوسط' : '🔴 سخت'}\n` +
        `💰 *امتیاز:* ${getPointsForDifficulty(session.difficulty)}\n` +
        `⏱️ *زمان:* ۲ دقیقه\n\n` +
        `_انجام بده یا رد کن!_`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ انجام دادم', 'tod_done')],
            [Markup.button.callback('⏭️ رد کردن چالش', 'tod_skip')],
            [Markup.button.callback('❌ انصراف', 'tod_cancel')],
          ]),
        }
      );
    } catch {}
  } else if (action === 'tod_skip') {
    if (userId !== session.challengedId) {
      await ctx.answerCbQuery('❌ فقط بازیکن مربوطه می‌تواند رد کند.');
      return;
    }
    session.skipCount++;
    if (session.skipCount >= 2) {
      sessions.delete(key);
      await ctx.answerCbQuery('❌ ۲ بار رد کردی! بازی لغو شد.');
      try {
        await ctx.editMessageText('❌ بازی جرعت و حقیقت لغو شد (۲ بار رد کردن).');
      } catch {}
      return;
    }
    const question = await getRandomQuestion(session.choice!, session.difficulty, botId);
    session.questionText = question;
    await ctx.answerCbQuery(`⏭️ سوال رد شد! (${session.skipCount}/2)`);
    try {
      await ctx.editMessageText(
        `🎭 *جرعت و حقیقت — سوال جدید*\n\n` +
        `${session.choice === 'truth' ? '❓' : '🔥'} *${session.choice === 'truth' ? 'سوال' : 'چالش'} جدید:*\n${question}\n\n` +
        `⏱️ *زمان:* ۲ دقیقه`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ انجام دادم', 'tod_done')],
            [Markup.button.callback('❌ انصراف', 'tod_cancel')],
          ]),
        }
      );
    } catch {}
  } else if (action === 'tod_done') {
    if (userId !== session.challengedId) {
      await ctx.answerCbQuery('❌ فقط بازیکن مربوطه می‌تواند تأیید کند.');
      return;
    }

    const user = await findUserByCtx(ctx);
    const points = getPointsForDifficulty(session.difficulty);
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { points: { increment: points } },
      });
      await prisma.pointTransaction.create({
        data: {
          userId: user.id,
          amount: points,
          type: 'BONUS',
          description: `بازی جرعت و حقیقت — ${session.choice === 'truth' ? 'حقیقت' : 'جرئت'} (${session.difficulty})`,
        },
      });
    }

    sessions.delete(key);
    await ctx.answerCbQuery(`🎉 آفرین! ${points} امتیاز گرفتی!`);
    try {
      await ctx.editMessageText(
        `🎭 *جرعت و حقیقت — پایان*\n\n` +
        `✅ ${mentionUser(session.challengedId!, session.challengedName)} ${session.choice === 'truth' ? 'به سوال جواب داد' : 'چالش رو انجام داد'}!\n\n` +
        `🎯 *سطح:* ${session.difficulty === 'easy' ? '🟢 آسان' : session.difficulty === 'medium' ? '🟡 متوسط' : '🔴 سخت'}\n` +
        `💰 *${points} امتیاز* دریافت شد!\n\n` +
        `برای بازی دوباره، از منوی بازی‌ها اقدام کنید.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  }
}

async function updateDifficultyMessage(ctx: Context, session: TodSession) {
  const points = getPointsForDifficulty(session.difficulty);
  const emoji = session.difficulty === 'easy' ? '🟢' : session.difficulty === 'medium' ? '🟡' : '🔴';
  
  try {
    await ctx.editMessageText(
      `🎭 *جرعت و حقیقت*\n\n` +
      `👤 ${mentionUser(session.challengerId, 'بازیکن')} چالش می‌زنه:\n` +
      `👉 ${mentionUser(session.challengedId!, session.challengedName)}\n\n` +
      `${mentionUser(session.challengedId!, session.challengedName)} انتخاب کن:\n` +
      `💬 *حقیقت* — یک سوال صادقانه جواب بده\n` +
      `💪 *جرئت* — یک چالش انجام بده\n\n` +
      `🎯 *سطح سختی:* ${emoji} ${session.difficulty === 'easy' ? 'آسان' : session.difficulty === 'medium' ? 'متوسط' : 'سخت'} (${points} امتیاز)\n` +
      `⏱️ *زمان:* ۲ دقیقه`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('💬 حقیقت', 'tod_truth'),
            Markup.button.callback('💪 جرئت', 'tod_dare'),
          ],
          [
            Markup.button.callback('🟢 آسان', 'tod_diff_easy'),
            Markup.button.callback('🟡 متوسط', 'tod_diff_medium'),
            Markup.button.callback('🔴 سخت', 'tod_diff_hard'),
          ],
          [Markup.button.callback('❌ انصراف', 'tod_cancel')],
        ]),
      }
    );
  } catch {}
}

// ─── Helpers ─────────────────────────────────
async function getGroupMembers(ctx: Context): Promise<{ id: number; name: string }[]> {
  try {
    const admins = await ctx.telegram.getChatAdministrators(ctx.chat!.id);
    return admins
      .filter((a) => !a.user.is_bot)
      .map((a) => ({
        id: a.user.id,
        name: a.user.first_name || a.user.username || 'بازیکن',
      }));
  } catch {
    return [{ id: ctx.from!.id, name: ctx.from!.first_name || 'بازیکن' }];
  }
}

function mentionUser(userId: number, name: string): string {
  return `[${name}](tg://user?id=${userId})`;
}

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > 180000) {
      sessions.delete(key);
    }
  }
}, 60000);
