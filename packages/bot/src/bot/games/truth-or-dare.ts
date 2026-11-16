import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { getSettingBool } from '../../lib/settings.js';
import { findUserByCtx } from '../../lib/user.js';
import {
  GAME_CANCEL_PURGE_DELAY_MS,
  GAME_RESULT_PURGE_DELAY_MS,
  checkGameChannelJoin,
  gameChatMode,
  purgeGameMessages,
  trackGameMessage,
  type GameChatMode,
} from './utils.js';
import {
  TOD_CATEGORY_EMOJI,
  TOD_CATEGORY_LABEL_FA,
  TOD_DIFFICULTY_EMOJI,
  TOD_DIFFICULTY_LABEL_FA,
  builtInTodQuestion,
  effectiveTodCategory,
  normalizeTodCategory,
  normalizeTodDifficulty,
  todPointsForDifficulty,
  type TodCategory,
  type TodChoice,
  type TodDifficulty,
} from './truth-or-dare-logic.js';

// ─── Types ───────────────────────────────────
interface TodSession {
  chatId: bigint;
  /**
   * کجا بازی می‌شود (نسخهٔ ۲٫۰٫۰). در پیوی حریف خودِ ربات است: او چالش
   * می‌زند، کاربر انتخاب می‌کند و جواب می‌دهد.
   */
  mode: GameChatMode;
  vsBot: boolean;
  challengerId: number;
  challengerName: string;
  challengedId: number | null;
  challengedName: string;
  status: 'choosing' | 'answered' | 'done';
  choice: TodChoice | null;
  questionText: string;
  messageId: number | null;
  difficulty: TodDifficulty;
  /** دستهٔ محتوای انتخابی بازیکن؛ «+۱۸» فقط با اجازهٔ پنل قابل انتخاب است */
  category: TodCategory;
  skipCount: number;
  /** چندمین نوبتِ بازیِ پیوی است (فقط برای متن «نوبت ۲») */
  round: number;
  createdAt: number;
}

const sessions = new Map<string, TodSession>();

function sessionKey(chatId: number | bigint): string {
  return `tod:${chatId}`;
}

/**
 * شناسهٔ بازیکن-ربات. آیدی تلگرام همیشه مثبت است، پس −۱ هیچ‌وقت با کاربر
 * واقعی قاطی نمی‌شود و لازم نیست جای آن mention ساخته شود.
 */
const BOT_ID = -1;
const BOT_NAME = 'ربات';

/** مهلت انتخاب و جواب دادن هر نوبت */
const TOD_ROUND_TIMEOUT_MS = 120_000;

function isBot(id: number | null): boolean {
  return id === BOT_ID;
}

function isExpired(session: TodSession): boolean {
  return Date.now() - session.createdAt > TOD_ROUND_TIMEOUT_MS;
}

// ─── Question selection ──────────────────────
/**
 * سؤال بعدی.
 * اول سؤالاتی که مدیر در پنل نوشته (از همان دستهٔ انتخابی)، وگرنه استخر
 * داخلی. دستهٔ «+۱۸» اگر در پنل خاموش باشد هرگز پرسیده نمی‌شود — حتی وقتی
 * بازیکن روی دکمهٔ «+۱۸» یک پیام قدیمی کلیک کرده باشد.
 */
async function getRandomQuestion(
  choice: TodChoice,
  difficulty: TodDifficulty,
  category: TodCategory
): Promise<string> {
  const nsfwAllowed = await getSettingBool('game_truth_or_dare_nsfw');
  const effective = effectiveTodCategory(category, nsfwAllowed);

  try {
    const questions = await prisma.gameQuestion.findMany({
      where: { gameType: 'TRUTH_OR_DARE', isActive: true, answer: choice, category: effective },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    if (questions.length > 0) {
      const random = questions[Math.floor(Math.random() * questions.length)];
      return random.text;
    }
  } catch {}

  return builtInTodQuestion(choice, difficulty, effective);
}

// ─── Keyboards & texts ───────────────────────
function choiceRows(nsfwAllowed: boolean): any[][] {
  const rows: any[][] = [
    [
      Markup.button.callback('💬 حقیقت', 'tod_truth'),
      Markup.button.callback('💪 جرئت', 'tod_dare'),
    ],
    [
      Markup.button.callback(`${TOD_DIFFICULTY_EMOJI.easy} آسان`, 'tod_diff_easy'),
      Markup.button.callback(`${TOD_DIFFICULTY_EMOJI.medium} متوسط`, 'tod_diff_medium'),
      Markup.button.callback(`${TOD_DIFFICULTY_EMOJI.hard} سخت`, 'tod_diff_hard'),
    ],
  ];
  // ردیف دسته فقط وقتی روی تخته می‌آید که مدیر «+۱۸» را در پنل روشن کرده باشد
  if (nsfwAllowed) {
    rows.push([
      Markup.button.callback(`${TOD_CATEGORY_EMOJI.sfw} ${TOD_CATEGORY_LABEL_FA.sfw}`, 'tod_cat_sfw'),
      Markup.button.callback(`${TOD_CATEGORY_EMOJI.nsfw} ${TOD_CATEGORY_LABEL_FA.nsfw}`, 'tod_cat_nsfw'),
    ]);
  }
  rows.push([Markup.button.callback('❌ انصراف', 'tod_cancel')]);
  return rows;
}

function choiceKeyboard(nsfwAllowed: boolean): any {
  return Markup.inlineKeyboard(choiceRows(nsfwAllowed));
}

function answeredKeyboard(choice: TodChoice, withSkip: boolean): any {
  const rows: any[][] = [
    [Markup.button.callback(choice === 'truth' ? '✅ جواب دادم' : '✅ انجام دادم', 'tod_done')],
  ];
  if (withSkip) rows.push([Markup.button.callback('⏭️ رد کردن', 'tod_skip')]);
  rows.push([Markup.button.callback('❌ انصراف', 'tod_cancel')]);
  return Markup.inlineKeyboard(rows);
}

/** «نوبت بعدی» فقط در پیوی معنی دارد: آنجا حریف همیشه ربات است */
function finishedKeyboard(session: TodSession): any {
  if (session.mode !== 'private') return {};
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎭 نوبت بعدی', 'tod_next')],
    [Markup.button.callback('🎮 منوی بازی', 'games')],
  ]);
}

function difficultyLine(session: TodSession): string {
  return `${TOD_DIFFICULTY_EMOJI[session.difficulty]} ${TOD_DIFFICULTY_LABEL_FA[session.difficulty]}`;
}

function categoryLine(session: TodSession): string {
  return `${TOD_CATEGORY_EMOJI[session.category]} ${TOD_CATEGORY_LABEL_FA[session.category]}`;
}

function choiceText(session: TodSession, nsfwAllowed: boolean): string {
  const points = todPointsForDifficulty(session.difficulty);
  const challenged = mentionUser(session.challengedId, session.challengedName);

  const head = session.vsBot
    ? `🎭 *جرعت و حقیقت* — نوبت ${faNum(session.round)}\n\n` +
      `🤖 ${BOT_NAME} از ${challenged} چالش می‌خواد:\n\n`
    : `🎭 *جرعت و حقیقت*\n\n` +
      `👤 ${mentionUser(session.challengerId, session.challengerName)} چالش می‌زنه:\n` +
      `👉 ${challenged}\n\n`;

  return (
    head +
    `${challenged} انتخاب کن:\n` +
    '💬 *حقیقت* — یک سوال صادقانه جواب بده\n' +
    '💪 *جرئت* — یک چالش انجام بده\n\n' +
    `🎯 *سطح سختی:* ${difficultyLine(session)} (${faNum(points)} امتیاز)\n` +
    (nsfwAllowed ? `🔞 *دسته:* ${categoryLine(session)}\n` : '') +
    `⏱️ *زمان:* ${faNum(TOD_ROUND_TIMEOUT_MS / 60_000)} دقیقه`
  );
}

function questionText(session: TodSession, question: string): string {
  const isTruth = session.choice === 'truth';

  return (
    `🎭 *جرعت و حقیقت — ${isTruth ? 'حقیقت' : 'جرئت'}*\n\n` +
    `${isTruth ? '💬' : '💪'} ${mentionUser(session.challengedId, session.challengedName)} ` +
    `${isTruth ? 'حقیقت رو انتخاب کرد' : 'جرئت رو انتخاب کرد'}!\n\n` +
    `${isTruth ? '❓' : '🔥'} *${isTruthLabel(session.choice)}:*\n${question}\n\n` +
    `🎯 *سطح:* ${difficultyLine(session)} | ${categoryLine(session)}\n` +
    `💰 *امتیاز:* ${faNum(todPointsForDifficulty(session.difficulty))}\n` +
    `⏱️ *زمان:* ${faNum(TOD_ROUND_TIMEOUT_MS / 60_000)} دقیقه\n\n` +
    `_${isTruth ? 'جواب بده یا رد کن' : 'انجام بده یا رد کن'}!_`
  );
}

function isTruthLabel(choice: TodChoice | null): string {
  return choice === 'truth' ? 'سوال' : 'چالش';
}

/** پاک‌سازی پیام‌های گروه؛ در پیوی چیزی پاک نمی‌شود (گفتگوی خودِ کاربر است) */
function purgeIfGroup(
  telegram: any,
  key: string,
  session: TodSession | undefined,
  delayMs: number
): void {
  if (!session || session.mode === 'group') void purgeGameMessages(telegram, key, delayMs);
}

// ─── Start Truth or Dare ─────────────────────
export async function handleTruthOrDare(ctx: Context) {
  const mode = await gameChatMode(ctx, 'جرعت و حقیقت');
  if (!mode) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && existing.status !== 'done' && !isExpired(existing)) {
    await ctx.reply('⏳ یک بازی جرعت و حقیقت در حال انجام است. لطفاً نوبتش را تمام کنید.');
    return;
  }

  const fromUser = ctx.from!;
  const nsfwAllowed = await getSettingBool('game_truth_or_dare_nsfw');
  const name = fromUser.first_name || fromUser.username || 'بازیکن';
  let session: TodSession;

  if (mode === 'private') {
    // پیوی: ربات چالش می‌زند و کاربر جواب می‌دهد
    session = newRound({
      chatId,
      mode,
      challengerId: BOT_ID,
      challengerName: BOT_NAME,
      challengedId: fromUser.id,
      challengedName: name,
    });
  } else {
    // گروه: چالش به یکی از اعضا — همان رفتار نسخه‌های قبل
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
    session = newRound({
      chatId,
      mode,
      challengerId: fromUser.id,
      challengerName: name,
      challengedId: challenged.id,
      challengedName: challenged.name,
    });
  }

  sessions.set(key, session);

  const msg: any = await ctx.reply(choiceText(session, nsfwAllowed), {
    parse_mode: 'Markdown',
    ...choiceKeyboard(nsfwAllowed),
  });
  if (typeof msg?.message_id === 'number') {
    session.messageId = msg.message_id;
    if (mode === 'group') trackGameMessage(key, chatId, msg.message_id, ctx.telegram);
  }
}

function newRound(init: {
  chatId: number;
  mode: GameChatMode;
  challengerId: number;
  challengerName: string;
  challengedId: number;
  challengedName: string;
  difficulty?: TodDifficulty;
  category?: TodCategory;
  round?: number;
}): TodSession {
  return {
    chatId: BigInt(init.chatId),
    mode: init.mode,
    vsBot: init.mode === 'private',
    challengerId: init.challengerId,
    challengerName: init.challengerName,
    challengedId: init.challengedId,
    challengedName: init.challengedName,
    status: 'choosing',
    choice: null,
    questionText: '',
    messageId: null,
    difficulty: init.difficulty ?? 'medium',
    category: init.category ?? 'sfw',
    skipCount: 0,
    round: init.round ?? 1,
    createdAt: Date.now(),
  };
}

// ─── Action Handler ──────────────────────────
export async function handleTruthOrDareAction(ctx: Context) {
  const action = (ctx.callbackQuery as any).data as string;
  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);
  const session = sessions.get(key);
  const nsfwAllowed = await getSettingBool('game_truth_or_dare_nsfw');

  if (!session) {
    await ctx.answerCbQuery('⏰ بازی منقضی شده یا وجود ندارد.');
    try {
      await ctx.editMessageText(
        '⏰ بازی جرعت و حقیقت منقضی شد. /joraat را دوباره بزن یا از منوی بازی‌ها شروعش کن.'
      );
    } catch {}
    return;
  }

  if (isExpired(session)) {
    sessions.delete(key);
    purgeIfGroup(ctx.telegram, key, session, GAME_CANCEL_PURGE_DELAY_MS);
    await ctx.answerCbQuery('⏰ زمان بازی تمام شد.');
    try {
      await ctx.editMessageText('⏰ بازی جرعت و حقیقت منقضی شد. /joraat را دوباره بزن.');
    } catch {}
    return;
  }

  const userId = ctx.from!.id;
  const isPlayer = userId === session.challengerId || userId === session.challengedId;

  // ── دستهٔ محتوا: +۱۸ / −۱۸ ──
  if (action.startsWith('tod_cat_')) {
    if (userId !== session.challengedId) {
      await ctx.answerCbQuery(`❌ فقط ${session.challengedName} می‌تواند دسته را انتخاب کند.`);
      return;
    }
    const chosen = normalizeTodCategory(action.replace('tod_cat_', ''));
    if (chosen === 'nsfw' && !nsfwAllowed) {
      session.category = 'sfw';
      await ctx.answerCbQuery('🔞 دستهٔ «+۱۸» در پنل غیرفعال است.');
      await editChoiceMessage(ctx, session, nsfwAllowed);
      return;
    }
    if (session.status !== 'choosing') {
      await ctx.answerCbQuery('⏳ این نوبت انتخاب شده است.');
      return;
    }
    session.category = chosen;
    session.createdAt = Date.now();
    await ctx.answerCbQuery(`${TOD_CATEGORY_EMOJI[chosen]} ${TOD_CATEGORY_LABEL_FA[chosen]}`);
    await editChoiceMessage(ctx, session, nsfwAllowed);
    return;
  }

  // ── سطح سختی ──
  if (action.startsWith('tod_diff_')) {
    if (userId !== session.challengedId) {
      await ctx.answerCbQuery(`❌ فقط ${session.challengedName} می‌تواند سطح سختی را انتخاب کند.`);
      return;
    }
    if (session.status !== 'choosing') {
      await ctx.answerCbQuery('⏳ این نوبت انتخاب شده است.');
      return;
    }
    const difficulty = normalizeTodDifficulty(action.replace('tod_diff_', ''));
    session.difficulty = difficulty;
    session.createdAt = Date.now();
    await ctx.answerCbQuery(
      `${TOD_DIFFICULTY_EMOJI[difficulty]} ${TOD_DIFFICULTY_LABEL_FA[difficulty]} — ` +
        `${faNum(todPointsForDifficulty(difficulty))} امتیاز`
    );
    await editChoiceMessage(ctx, session, nsfwAllowed);
    return;
  }

  // ── نوبت بعدی (بازیِ پیوی مقابل ربات) ──
  if (action === 'tod_next') {
    if (session.mode !== 'private') {
      await ctx.answerCbQuery('🎭 در گروه، برای نوبت بعدی دوباره /joraat را بزنید.');
      return;
    }
    if (!isPlayer) {
      await ctx.answerCbQuery('❌ فقط بازیکن می‌تواند نوبت بعدی را بگیرد.');
      return;
    }
    const fresh = newRound({
      chatId,
      mode: 'private',
      challengerId: BOT_ID,
      challengerName: BOT_NAME,
      challengedId: session.challengedId ?? userId,
      challengedName: session.challengedName,
      difficulty: session.difficulty,
      category: session.category,
      round: session.round + 1,
    });
    sessions.set(key, fresh);
    await ctx.answerCbQuery('🤖 ربات نوبت بعدی را می‌پرسد.');
    await editChoiceMessage(ctx, fresh, nsfwAllowed);
    return;
  }

  if (action === 'tod_cancel') {
    if (!isPlayer) {
      await ctx.answerCbQuery('❌ فقط بازیکنان می‌توانند بازی را لغو کنند.');
      return;
    }
    sessions.delete(key);
    purgeIfGroup(ctx.telegram, key, session, GAME_CANCEL_PURGE_DELAY_MS);
    await ctx.answerCbQuery('بازی لغو شد.');
    try {
      await ctx.editMessageText('❌ بازی جرعت و حقیقت لغو شد.');
    } catch {}
    return;
  }

  if (userId !== session.challengedId) {
    await ctx.answerCbQuery(`❌ فقط ${session.challengedName} می‌تواند انتخاب کند.`);
    return;
  }

  if (session.status === 'done') {
    await ctx.answerCbQuery(
      session.mode === 'private'
        ? '🎭 این نوبت تمام شد — دکمهٔ «🎭 نوبت بعدی» را بزن.'
        : '🎭 این نوبت تمام شد.'
    );
    return;
  }

  // ── جواب دادم / انجام دادم ──
  if (action === 'tod_done') {
    if (session.status !== 'answered' || !session.choice) {
      await ctx.answerCbQuery('⏳ اول حقیقت یا جرئت را انتخاب کن.');
      return;
    }
    const points = todPointsForDifficulty(session.difficulty);
    const isGroup = session.mode === 'group';
    await awardPoints(ctx, session, points);

    session.status = 'done';
    session.createdAt = Date.now();
    if (isGroup) sessions.delete(key);

    await ctx.answerCbQuery(`🎉 آفرین! ${faNum(points)} امتیاز گرفتی!`);
    try {
      await ctx.editMessageText(
        `🎭 *جرعت و حقیقت — پایان نوبت*\n\n` +
          `✅ ${mentionUser(session.challengedId, session.challengedName)} ` +
          `${session.choice === 'truth' ? 'به سوال جواب داد' : 'چالش رو انجام داد'}!\n\n` +
          `🎯 *سطح:* ${difficultyLine(session)} | ${categoryLine(session)}\n` +
          `💰 *${faNum(points)} امتیاز* دریافت شد!\n\n` +
          (session.mode === 'private'
            ? '🤖 ربات منتظر نوبت بعدی است — دکمهٔ «🎭 نوبت بعدی».'
            : 'برای بازی دوباره، از منوی بازی‌ها اقدام کنید.'),
        { parse_mode: 'Markdown', ...finishedKeyboard(session) }
      );
    } catch {}
    if (isGroup) purgeIfGroup(ctx.telegram, key, session, GAME_RESULT_PURGE_DELAY_MS);
    return;
  }

  // ── رد کردن ──
  if (action === 'tod_skip') {
    if (session.status !== 'answered' || !session.choice) {
      await ctx.answerCbQuery('⏳ اول حقیقت یا جرئت را انتخاب کن.');
      return;
    }
    session.skipCount++;
    if (session.skipCount >= 2) {
      sessions.delete(key);
      purgeIfGroup(ctx.telegram, key, session, GAME_CANCEL_PURGE_DELAY_MS);
      await ctx.answerCbQuery('❌ ۲ بار رد کردی! بازی لغو شد.');
      try {
        await ctx.editMessageText('❌ بازی جرعت و حقیقت لغو شد (۲ بار رد کردن).');
      } catch {}
      return;
    }
    const question = await getRandomQuestion(session.choice, session.difficulty, session.category);
    session.questionText = question;
    session.createdAt = Date.now();
    await ctx.answerCbQuery(
      `⏭️ ${isTruthLabel(session.choice)} رد شد! (${faNum(session.skipCount)}/۲)`
    );
    try {
      await ctx.editMessageText(questionText(session, question), {
        parse_mode: 'Markdown',
        ...answeredKeyboard(session.choice, true),
      });
    } catch {}
    return;
  }

  // ── انتخاب حقیقت / جرئت ──
  if (action === 'tod_truth' || action === 'tod_dare') {
    if (session.status !== 'choosing') {
      await ctx.answerCbQuery('⏳ این نوبت انتخاب شده است.');
      return;
    }
    const choice: TodChoice = action === 'tod_truth' ? 'truth' : 'dare';
    session.choice = choice;
    session.status = 'answered';
    const question = await getRandomQuestion(choice, session.difficulty, session.category);
    session.questionText = question;

    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(questionText(session, question), {
        parse_mode: 'Markdown',
        ...answeredKeyboard(choice, true),
      });
    } catch {}
    return;
  }

  await ctx.answerCbQuery('❓ این دکمه دیگر در این بازی کار نمی‌کند.');
}

// ─── Helpers ─────────────────────────────────
async function editChoiceMessage(ctx: Context, session: TodSession, nsfwAllowed: boolean) {
  try {
    await ctx.editMessageText(choiceText(session, nsfwAllowed), {
      parse_mode: 'Markdown',
      ...choiceKeyboard(nsfwAllowed),
    });
  } catch {}
}

async function awardPoints(ctx: Context, session: TodSession, points: number) {
  const user = await findUserByCtx(ctx);
  if (!user) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { points: { increment: points } },
  });
  await prisma.pointTransaction.create({
    data: {
      userId: user.id,
      amount: points,
      type: 'BONUS',
      description:
        `بازی جرعت و حقیقت — ${session.choice === 'truth' ? 'حقیقت' : 'جرئت'} ` +
        `(${TOD_DIFFICULTY_LABEL_FA[session.difficulty]}، ${TOD_CATEGORY_LABEL_FA[session.category]})`,
    },
  });
}

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

function mentionUser(userId: number | null, name: string): string {
  if (userId === null || isBot(userId)) return `🤖 ${BOT_NAME}`;
  return `[${safeName(name)}](tg://user?id=${userId})`;
}

function safeName(name: string): string {
  return name.replace(/[[\]*_~`>]/g, '').trim() || 'بازیکن';
}

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

function faNum(value: number | string): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

// نشست‌های رهاشده: اگر کسی نوبتش را رها کند، صندلی در حافظه آزاد می‌شود.
setInterval(() => {
  const cutoff = Date.now() - (TOD_ROUND_TIMEOUT_MS + 60_000);
  for (const [key, session] of sessions.entries()) {
    if (session.createdAt < cutoff) sessions.delete(key);
  }
}, 60_000);
