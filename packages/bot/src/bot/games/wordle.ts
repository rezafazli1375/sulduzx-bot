import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { findUserByCtx } from '../../lib/user.js';
import { requireGroup, checkGameChannelJoin } from './utils.js';

// ─── Types ───────────────────────────────────
interface WordleSession {
  chatId: number;
  messageId: number;
  targetWord: string;
  guesses: string[];
  maxGuesses: number;
  currentGuess: string;
  status: 'playing' | 'won' | 'lost';
  playerId: number;
  playerName: string;
  createdAt: number;
}

const sessions = new Map<string, WordleSession>();

function sessionKey(chatId: number): string {
  return `wordle:${chatId}`;
}

// ─── Persian word list (5-letter words) ──────
const persianWords = [
  'کتاب', 'مادر', 'پدر', 'برادر', 'خواهر', 'دوست', 'خوشحال', 'غمگین',
  'آسمان', 'زمین', 'دریا', 'کوهستان', 'جنگل', 'صحرا', 'شهر', 'روستا',
  'خورشید', 'ماه', 'ستاره', 'ابر', 'باران', 'برف', 'باد', 'طوفان',
  'گل', 'درخت', 'سبز', 'قرمز', 'آبی', 'زرد', 'سفید', 'سیاه',
  'خانه', 'مدرسه', 'دانشگاه', 'بازار', 'پارک', 'خیابان', 'کوچه', 'پل',
  'آب', 'نان', 'غذا', 'میوه', 'سبزی', 'شیر', 'چای', 'قهوه',
  'مادر', 'پدر', 'فرزند', 'خانواده', 'عشق', 'امید', 'زندگی', 'مرگ',
  'خنده', 'گریه', 'شادی', 'غم', 'ترس', 'شجاعت', 'مهربانی', 'خشونت',
  'سیب', 'پرتقال', 'موز', 'انگور', 'هندوانه', 'خربزه', 'گیلاس', 'توت',
  'گربه', 'سگ', 'پرنده', 'ماهی', 'شیر', 'ببر', 'فیل', 'زرافه',
];

// Normalize Persian letters so every character can be typed on the keyboard
function normalizeWord(word: string): string {
  return word
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ی')
    .replace(/ة/g, 'ه')
    .replace(/[\u200c\u200f\u200e]/g, '')
    .trim();
}

async function getRandomWord(): Promise<string> {
  try {
    // Fetch random active WORDLE question from database
    const questions = await prisma.gameQuestion.findMany({
      where: {
        gameType: 'WORDLE',
        isActive: true,
      },
    });
    
    if (questions.length === 0) {
      // Fallback to hardcoded list if no questions in DB
      const words = persianWords.filter(w => w.length === 5);
      return words.length > 0 ? words[Math.floor(Math.random() * words.length)] : 'کتاب';
    }
    
    const randomQuestion = questions[Math.floor(Math.random() * questions.length)];
    return normalizeWord(randomQuestion.text);
  } catch (error) {
    console.error('Error fetching Wordle word from DB:', error);
    const words = persianWords.filter(w => w.length === 5);
    return words.length > 0 ? words[Math.floor(Math.random() * words.length)] : 'کتاب';
  }
}

// ─── Guess evaluation ────────────────────────
function evaluateGuess(guess: string, target: string): ('correct' | 'present' | 'absent')[] {
  const len = target.length;
  const result: ('correct' | 'present' | 'absent')[] = Array(len).fill('absent');
  const targetChars = target.split('');
  const guessChars = guess.split('');
  const used = Array(len).fill(false);

  // First pass: correct positions
  for (let i = 0; i < len; i++) {
    if (guessChars[i] === targetChars[i]) {
      result[i] = 'correct';
      used[i] = true;
    }
  }

  // Second pass: present but wrong position
  for (let i = 0; i < len; i++) {
    if (result[i] === 'correct') continue;
    for (let j = 0; j < len; j++) {
      if (!used[j] && guessChars[i] === targetChars[j]) {
        result[i] = 'present';
        used[j] = true;
        break;
      }
    }
  }

  return result;
}

function getLetterEmoji(letter: string, status: 'correct' | 'present' | 'absent'): string {
  if (status === 'correct') return `🟩`;
  if (status === 'present') return `🟨`;
  return `⬛`;
}

function renderGuess(guess: string, evaluation: ('correct' | 'present' | 'absent')[]): string {
  const letters = guess.split('');
  return letters.map((l, i) => `${getLetterEmoji(l, evaluation[i])} ${l}`).join('  ');
}

function renderBoard(session: WordleSession): string {
  let board = '';
  const len = session.targetWord.length;
  const emptyRow = ('⬜ '.repeat(len)).trim();

  for (let i = 0; i < session.guesses.length; i++) {
    const evaluation = evaluateGuess(session.guesses[i], session.targetWord);
    board += renderGuess(session.guesses[i], evaluation) + '\n';
  }

  // Show current guess in progress
  if (session.status === 'playing' && session.currentGuess.length > 0) {
    const emptySlots = len - session.currentGuess.length;
    board += '🔲 '.repeat(session.currentGuess.length) + session.currentGuess.split('').join('  ') + '\n';
    board += '⬜ '.repeat(emptySlots) + '...';
  } else if (session.status === 'playing') {
    board += emptyRow + '\n';
    board += emptyRow + '\n';
  }

  // Fill remaining empty rows
  const remainingRows = session.maxGuesses - session.guesses.length - (session.status === 'playing' ? 1 : 0);
  for (let i = 0; i < remainingRows; i++) {
    board += emptyRow + '\n';
  }

  return board.trim();
}

function buildWordleKeyboard(session: WordleSession): any {
  if (session.status !== 'playing') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🔄 بازی جدید', 'wordle_new')],
      [Markup.button.callback('🔙 منوی بازی', 'games')],
    ]);
  }

  const persianLetters = 'ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی';
  const rows = [];
  
  // Row 1-3: letters
  for (let i = 0; i < 3; i++) {
    const row = [];
    for (let j = 0; j < 5; j++) {
      const letterIdx = i * 5 + j;
      if (letterIdx < persianLetters.length) {
        row.push(Markup.button.callback(persianLetters[letterIdx], `wordle_letter_${persianLetters[letterIdx]}`));
      }
    }
    rows.push(row);
  }

  // Row 4: more letters
  const row4 = [];
  for (let i = 15; i < 20 && i < persianLetters.length; i++) {
    row4.push(Markup.button.callback(persianLetters[i], `wordle_letter_${persianLetters[i]}`));
  }
  rows.push(row4);

  // Row 5: more letters
  const row5 = [];
  for (let i = 20; i < 25 && i < persianLetters.length; i++) {
    row5.push(Markup.button.callback(persianLetters[i], `wordle_letter_${persianLetters[i]}`));
  }
  rows.push(row5);

  // Row 6: more letters
  const row6 = [];
  for (let i = 25; i < 30 && i < persianLetters.length; i++) {
    row6.push(Markup.button.callback(persianLetters[i], `wordle_letter_${persianLetters[i]}`));
  }
  rows.push(row6);

  // Row 7: more letters
  const row7 = [];
  for (let i = 30; i < persianLetters.length; i++) {
    row7.push(Markup.button.callback(persianLetters[i], `wordle_letter_${persianLetters[i]}`));
  }
  rows.push(row7);

  // Action buttons
  rows.push([
    Markup.button.callback('⬅️ پاک کردن', 'wordle_delete'),
    Markup.button.callback('✅ ثبت', 'wordle_submit'),
  ]);
  rows.push([
    Markup.button.callback('❌ لغو', 'wordle_cancel'),
  ]);

  return Markup.inlineKeyboard(rows);
}

// ─── Start Wordle ────────────────────────────
export async function handleWordle(ctx: Context) {
  if (!(await requireGroup(ctx, 'کلمه‌یاب'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && existing.status === 'playing' && Date.now() - existing.createdAt < 600000) {
    await ctx.reply('⏳ یک بازی کلمه‌یاب در حال انجام است. لطفاً صبر کنید تا تمام شود.');
    return;
  }

  const fromUser = ctx.from!;
  const targetWord = await getRandomWord();

  const session: WordleSession = {
    chatId,
    messageId: 0,
    targetWord,
    guesses: [],
    maxGuesses: 6,
    currentGuess: '',
    status: 'playing',
    playerId: fromUser.id,
    playerName: fromUser.first_name || 'بازیکن',
    createdAt: Date.now(),
  };
  sessions.set(key, session);

  const msg = await ctx.reply(
    `🔤 *کلمه‌یاب (Wordle فارسی)*\n\n` +
    `🎮 ${mentionUser(fromUser.id, fromUser.first_name || 'بازیکن')} بازی را شروع کرد!\n\n` +
    `📋 *قوانین:*\n` +
    `• یک کلمه ${targetWord.length} حرفی انتخاب شده\n` +
    `• ۶ تلاش برای حدس زدن داری\n` +
    `• 🟩 = حرف درست در جای درست\n` +
    `• 🟨 = حرف درست در جای اشتباه\n` +
    `• ⬛ = حرف اشتباه\n\n` +
    `${renderBoard(session)}\n\n` +
    `🎯 *امتیاز:* ۴۰ برای برد`,
    { parse_mode: 'Markdown', ...buildWordleKeyboard(session) }
  );

  session.messageId = msg.message_id;
}

// ─── Action Handler ──────────────────────────
export async function handleWordleAction(ctx: Context) {
  const action = (ctx.callbackQuery as any).data as string;
  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);
  const session = sessions.get(key);

  if (!session) {
    await ctx.answerCbQuery('⏰ بازی منقضی شده یا وجود ندارد.');
    return;
  }

  const userId = ctx.from!.id;

  if (action === 'wordle_cancel') {
    if (userId !== session.playerId) {
      await ctx.answerCbQuery('❌ فقط بازیکن اصلی می‌تواند لغو کند.');
      return;
    }
    sessions.delete(key);
    await ctx.answerCbQuery('بازی لغو شد.');
    try {
      await ctx.editMessageText('❌ بازی کلمه‌یاب لغو شد.');
    } catch {}
    return;
  }

  if (action === 'wordle_new') {
    sessions.delete(key);
    await ctx.answerCbQuery();
    await handleWordle(ctx);
    return;
  }

  if (session.status !== 'playing') {
    await ctx.answerCbQuery('بازی تمام شده!');
    return;
  }

  if (userId !== session.playerId) {
    await ctx.answerCbQuery('❌ فقط بازیکن اصلی می‌تواند بازی کند!');
    return;
  }

  if (action === 'wordle_delete') {
    if (session.currentGuess.length > 0) {
      session.currentGuess = session.currentGuess.slice(0, -1);
      await ctx.answerCbQuery();
      await updateWordleMessage(ctx, session);
    } else {
      await ctx.answerCbQuery('چیزی برای پاک کردن نیست!');
    }
    return;
  }

  if (action === 'wordle_submit') {
    if (session.currentGuess.length !== session.targetWord.length) {
      await ctx.answerCbQuery(`❌ کلمه باید ${session.targetWord.length} حرف باشد!`);
      return;
    }

    session.guesses.push(session.currentGuess);
    session.currentGuess = '';

    // Check if won
    if (session.guesses[session.guesses.length - 1] === session.targetWord) {
      session.status = 'won';
      await awardWordleWinner(ctx, session);
      await ctx.answerCbQuery('🎉 تبریک! برنده شدی!');
      await updateWordleMessage(ctx, session);
      return;
    }

    // Check if lost
    if (session.guesses.length >= session.maxGuesses) {
      session.status = 'lost';
      await ctx.answerCbQuery(`❌ باختی! کلمه: ${session.targetWord}`);
      await updateWordleMessage(ctx, session);
      return;
    }

    await ctx.answerCbQuery(`تلاش ${session.guesses.length}/${session.maxGuesses}`);
    await updateWordleMessage(ctx, session);
    return;
  }

  if (action.startsWith('wordle_letter_')) {
    const letter = action.replace('wordle_letter_', '');
    if (session.currentGuess.length < session.targetWord.length) {
      session.currentGuess += letter;
      await ctx.answerCbQuery();
      await updateWordleMessage(ctx, session);
    } else {
      await ctx.answerCbQuery('❌ کلمه پر است! ابتدا ثبت یا پاک کن.');
    }
    return;
  }
}

async function awardWordleWinner(ctx: Context, session: WordleSession) {
  try {
    const user = await prisma.user.findFirst({
      where: { telegramId: BigInt(session.playerId), botId: (ctx as any).botId },
    });
    if (user) {
      const rewardPoints = 40;
      await prisma.user.update({
        where: { id: user.id },
        data: { points: { increment: rewardPoints } },
      });
      await prisma.pointTransaction.create({
        data: {
          userId: user.id,
          amount: rewardPoints,
          type: 'BONUS',
          description: 'بازی کلمه‌یاب — برنده',
        },
      });
    }
  } catch {}
}

async function updateWordleMessage(ctx: Context, session: WordleSession) {
  let statusText: string;
  if (session.status === 'won') {
    statusText = `🏆 *برنده شدی!* کلمه: ${session.targetWord}\n🎉 ۴۰ امتیاز دریافت شد!`;
  } else if (session.status === 'lost') {
    statusText = `❌ *باختی!* کلمه: ${session.targetWord}`;
  } else {
    statusText = `🎯 تلاش ${session.guesses.length + 1}/${session.maxGuesses}`;
  }

  const text =
    `🔤 *کلمه‌یاب (Wordle فارسی)*\n\n` +
    `👤 ${mentionUser(session.playerId, session.playerName)}\n\n` +
    `${renderBoard(session)}\n\n` +
    `${statusText}`;

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...buildWordleKeyboard(session),
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
