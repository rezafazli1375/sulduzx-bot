import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { getSetting, getSettingNumber } from '../../lib/settings.js';
import {
  GAME_CANCEL_PURGE_DELAY_MS,
  GAME_RESULT_PURGE_DELAY_MS,
  checkGameChannelJoin,
  purgeGameMessages,
  requireGroup,
  sendGameMessage,
} from './utils.js';
import {
  LetterStatus,
  LETTER_ROWS,
  STATUS_EMOJI,
  BUILTIN_WORD_LIST,
  WordEntry,
  normalizeWord,
  evaluateGuess,
  mergeStatus,
  renderSpots,
  tehranDateKey,
  pickDailyWord,
  pickRandomWord,
} from './wordle-logic.js';

// ─── Types ───────────────────────────────────
interface WordlePlayer {
  id: number;
  name: string;
  attempts: number;
  hints: number;
  won: boolean;
  eliminated: boolean;
  buffer: string;
  awarded: boolean;
}

interface WordleRow {
  playerId: number;
  name: string;
  guess: string;
  statuses: LetterStatus[];
}

interface WordleHint {
  playerId: number;
  name: string;
  text: string;
}

interface WordleSession {
  chatId: number;
  messageId: number;
  ctx: Context | null;
  mode: 'daily' | 'random';
  word: string;
  meaning: string;
  length: number;
  maxGuesses: number;
  players: WordlePlayer[];
  rows: WordleRow[];
  letterStates: Map<string, LetterStatus>;
  revealed: Map<number, string>;
  hints: WordleHint[];
  meaningHintUsed: boolean;
  status: 'choosing' | 'playing' | 'finished';
  winnerId: number | null;
  dateKey: string;
  activeTypingId: number | null;
  signature: string;
  lastReplyAt: Map<number, number>;
  createdAt: number;
}

// ─── Constants ───────────────────────────────
const MAX_PLAYERS = 6;
const MAX_HINTS = 2;
const MAX_GUESSES = 6;
const BASE_POINTS = 40;
const HINT_COST = 10;
const PARTICIPATION_POINTS = 10;
const DEFAULT_LENGTH = 5;
const MIN_LENGTH = 4;
const MAX_LENGTH = 8;
const SESSION_TTL = 2 * 60 * 60 * 1000;
const MAX_BOARD_ROWS = 12;
const REPLY_COOLDOWN = 15000;
const GUESS_COOLDOWN = 2000;

const sessions = new Map<string, WordleSession>();

function sessionKey(chatId: number): string {
  return `wordle:${chatId}`;
}

// ─── Helpers ─────────────────────────────────
const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

function faNum(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** نام بازیکن را از کاراکترهای خاص Markdown پاک می‌کند */
function safeName(name: string): string {
  const cleaned = (name || '')
    .replace(/[\\*_`~[\]{}()#+\-=|.!<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 24) || 'بازیکن';
}

function mentionUser(userId: number, name: string): string {
  return `[${safeName(name)}](tg://user?id=${userId})`;
}

// ─── Word pool ───────────────────────────────
async function getWordLength(): Promise<number> {
  try {
    const raw = await getSettingNumber('game_wordle_length');
    if (raw >= MIN_LENGTH && raw <= MAX_LENGTH) return raw;
  } catch {}
  return DEFAULT_LENGTH;
}

/** آیا بازی کلمه‌یاب فعال است؟ (کلید نبودن یعنی فعال) */
async function isWordleEnabled(): Promise<boolean> {
  try {
    for (const key of ['games_enabled', 'game_wordle_enabled']) {
      const value = await getSetting(key);
      if (value !== null && value !== 'true') return false;
    }
  } catch {}
  return true;
}

/** بانک کلمات: کلمات پنل (با معنی) + بانک داخلی — همه با طول یکسان */
export async function loadWordPool(length: number): Promise<WordEntry[]> {
  const builtin = BUILTIN_WORD_LIST.filter((e) => e.word.length === length);
  const fromDb: WordEntry[] = [];

  try {
    const rows = await prisma.gameQuestion.findMany({
      where: { gameType: 'WORDLE', isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) {
      const word = normalizeWord(row.text || '');
      if (word.length !== length) continue;
      fromDb.push({ word, meaning: (row.optionA || '').trim() });
    }
  } catch (error) {
    console.error('Wordle pool load error:', error);
  }

  const merged = new Map<string, WordEntry>();
  for (const entry of [...fromDb, ...builtin]) {
    const existing = merged.get(entry.word);
    if (!existing) {
      merged.set(entry.word, { ...entry });
    } else if (!existing.meaning && entry.meaning) {
      existing.meaning = entry.meaning;
    }
  }

  const pool = [...merged.values()];
  if (pool.length >= 10) return pool;
  return BUILTIN_WORD_LIST.filter((e) => e.word.length === DEFAULT_LENGTH);
}

// ─── Session helpers ─────────────────────────
function createSession(chatId: number): WordleSession {
  return {
    chatId,
    messageId: 0,
    ctx: null,
    mode: 'daily',
    word: '',
    meaning: '',
    length: DEFAULT_LENGTH,
    maxGuesses: MAX_GUESSES,
    players: [],
    rows: [],
    letterStates: new Map(),
    revealed: new Map(),
    hints: [],
    meaningHintUsed: false,
    status: 'choosing',
    winnerId: null,
    dateKey: tehranDateKey(),
    activeTypingId: null,
    signature: '',
    lastReplyAt: new Map(),
    createdAt: Date.now(),
  };
}

function findPlayer(session: WordleSession, userId: number): WordlePlayer | undefined {
  return session.players.find((p) => p.id === userId);
}

/** بازیکن را ثبت می‌کند (اگر ظرفیت داشته باشد) */
function ensurePlayer(
  session: WordleSession,
  userId: number,
  name: string
): WordlePlayer | null {
  const existing = findPlayer(session, userId);
  if (existing) return existing;
  if (session.players.length >= MAX_PLAYERS) return null;

  const player: WordlePlayer = {
    id: userId,
    name: safeName(name),
    attempts: 0,
    hints: 0,
    won: false,
    eliminated: false,
    buffer: '',
    awarded: false,
  };
  session.players.push(player);
  return player;
}

// ─── Rendering ───────────────────────────────
function renderGuessRow(
  guess: string,
  statuses: LetterStatus[],
  revealed: Map<number, string>
): string {
  const cells: string[] = [];
  for (let i = 0; i < guess.length; i++) {
    const hint = revealed.get(i);
    if (hint) {
      cells.push(`${STATUS_EMOJI.correct}${hint}`);
      continue;
    }
    cells.push(`${STATUS_EMOJI[statuses[i] ?? 'absent']}${guess[i]}`);
  }
  return cells.join(' ');
}

function renderTypingRow(
  buffer: string,
  length: number,
  revealed: Map<number, string>
): string {
  const cells: string[] = [];
  for (let i = 0; i < length; i++) {
    const hint = revealed.get(i);
    if (hint) {
      cells.push(`${STATUS_EMOJI.correct}${hint}`);
      continue;
    }
    cells.push(i < buffer.length ? `⬜${buffer[i]}` : '⬜');
  }
  return cells.join(' ');
}

function renderBoard(session: WordleSession): string {
  const lines: string[] = [];
  const visible = session.rows.slice(-MAX_BOARD_ROWS);
  const hidden = session.rows.length - visible.length;

  for (const row of visible) {
    lines.push(
      `${safeName(row.name)}: ${renderGuessRow(row.guess, row.statuses, session.revealed)}`
    );
  }
  if (hidden > 0) {
    lines.push(`… و ${faNum(hidden)} حدس دیگر`);
  }
  if (lines.length === 0) {
    lines.push('_هنوز حدسی ثبت نشده_');
  }
  return lines.join('\n');
}

function renderPlayers(session: WordleSession): string {
  if (session.players.length === 0) return '_هنوز کسی وارد نشده_';
  return session.players
    .map((p) => {
      const mark = p.won ? '🏆' : p.eliminated ? '❌' : '';
      return `${mark}${mentionUser(p.id, p.name)} (${faNum(p.attempts)}/${faNum(session.maxGuesses)})`;
    })
    .join(' · ');
}

function buildText(session: WordleSession): string {
  const length = faNum(session.length);

  if (session.status === 'choosing') {
    return (
      `🔤 *کلمه‌یاب*\n\n` +
      `یک کلمهٔ ${length} حرفی مخفی است — هرکس زودتر حدسش را بزند برنده می‌شود!\n\n` +
      `📅 *کلمهٔ امروز* — کلمه‌ای مشترک برای همه\n` +
      `🎲 *کلمهٔ تصادفی* — کلمه‌ای تازه برای هر دور\n\n` +
      `📋 *قوانین:*\n` +
      `• ${faNum(session.maxGuesses)} تلاش برای هر نفر\n` +
      `• 🟩 حرف درست در جای درست\n` +
      `• 🟨 حرف درست در جای اشتباه\n` +
      `• ⬛ این حرف در کلمه نیست\n\n` +
      `👇 یکی را انتخاب کنید`
    );
  }

  const header = `🔤 *کلمه‌یاب* — ${length} حرف`;

  if (session.status === 'finished') {
    const lines: string[] = [header, ''];
    const winner = session.players.find((p) => p.id === session.winnerId);

    if (winner) {
      const reward = Math.max(10, BASE_POINTS - winner.hints * HINT_COST);
      lines.push(`🏆 *برنده:* ${mentionUser(winner.id, winner.name)}`);
      lines.push(`🎉 ${faNum(reward)} امتیاز`);
    } else {
      lines.push('🤝 *بازی تمام شد!*');
    }

    lines.push('');
    lines.push(`🔑 کلمه: *${session.word}*`);
    if (session.meaning) lines.push(`📖 معنی: ${session.meaning}`);
    lines.push('');
    lines.push(`👥 ${renderPlayers(session)}`);

    if (winner) {
      const winnerRows = session.rows.filter((r) => r.playerId === winner.id);
      if (winnerRows.length > 0) {
        lines.push('');
        lines.push('*📤 نتیجهٔ برنده (برای اشتراک‌گذاری):*');
        for (const row of winnerRows) {
          lines.push(renderSpots(row.guess, row.statuses));
        }
      }
    }

    if (session.hints.length > 0) {
      lines.push('');
      lines.push('💡 *راهنماها:*');
      for (const hint of session.hints) {
        lines.push(`• ${safeName(hint.name)}: ${hint.text}`);
      }
    }

    lines.push('');
    lines.push(renderBoard(session));
    return lines.join('\n');
  }

  const lines: string[] = [header, ''];
  lines.push(`👥 ${renderPlayers(session)}`);
  lines.push('');
  lines.push(renderBoard(session));

  const active = session.players.find((p) => p.id === session.activeTypingId);
  if (active && active.buffer.length > 0) {
    lines.push('');
    lines.push(
      `✍️ ${mentionUser(active.id, active.name)}: ${renderTypingRow(active.buffer, session.length, session.revealed)}`
    );
  }

  if (session.hints.length > 0) {
    lines.push('');
    lines.push('💡 *راهنماها:*');
    for (const hint of session.hints) {
      lines.push(`• ${safeName(hint.name)}: ${hint.text}`);
    }
  }

  lines.push('');
  lines.push('🟩 درست · 🟨 در کلمه · ⬛ نیست');
  lines.push('');
  lines.push(
    `✍️ کلمه را همین‌جا در گروه بنویسید (${length} حرف) — یا با دکمه‌های صفحه‌کلید`
  );
  return lines.join('\n');
}

function buildKeyboard(session: WordleSession): any {
  if (session.status === 'choosing') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📅 کلمهٔ امروز', 'wordle_mode_daily')],
      [Markup.button.callback('🎲 کلمهٔ تصادفی', 'wordle_mode_random')],
      [Markup.button.callback('🎮 منوی بازی', 'games')],
    ]);
  }

  if (session.status === 'finished') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🔄 بازی جدید', 'wordle_new'),
        Markup.button.callback('🎮 منوی بازی', 'games'),
      ],
    ]);
  }

  const rows: any[][] = [];

  for (const letters of LETTER_ROWS) {
    const row: any[] = [];
    for (const letter of letters) {
      const button: any = Markup.button.callback(letter, `wordle_letter_${letter}`);
      const state = session.letterStates.get(letter);
      if (state === 'correct') button.style = 'success';
      else if (state === 'present') button.style = 'primary';
      else if (state === 'absent') button.style = 'danger';
      row.push(button);
    }
    rows.push(row);
  }

  rows.push([
    Markup.button.callback('⌫ پاک کردن', 'wordle_back'),
    Markup.button.callback('✅ ثبت', 'wordle_submit'),
  ]);

  rows.push([
    Markup.button.callback('💡 راهنما', 'wordle_hint'),
    Markup.button.callback('❌ لغو', 'wordle_cancel'),
    Markup.button.callback('🎮 منوی بازی', 'games'),
  ]);

  return Markup.inlineKeyboard(rows);
}

// ─── Message refresh ─────────────────────────
async function refresh(session: WordleSession): Promise<void> {
  const ctx = session.ctx;
  if (!ctx || !session.messageId) return;

  const text = buildText(session);
  const keyboard = buildKeyboard(session);
  const signature = `${text}|${JSON.stringify(keyboard)}`;
  if (signature === session.signature) return;
  session.signature = signature;

  try {
    await ctx.telegram.editMessageText(
      session.chatId.toString(),
      session.messageId,
      undefined,
      text,
      { parse_mode: 'Markdown', ...keyboard }
    );
  } catch {}
}

// ─── Game logic ──────────────────────────────
interface GuessResult {
  won: boolean;
  exhausted: boolean;
  statuses: LetterStatus[];
}

function submitGuess(
  session: WordleSession,
  player: WordlePlayer,
  guess: string
): GuessResult {
  const statuses = evaluateGuess(guess, session.word);
  session.rows.push({ playerId: player.id, name: player.name, guess, statuses });
  player.attempts += 1;
  player.buffer = '';

  for (let i = 0; i < guess.length; i++) {
    const letter = guess[i];
    session.letterStates.set(
      letter,
      mergeStatus(session.letterStates.get(letter), statuses[i])
    );
  }

  const won = guess === session.word;
  if (won) {
    player.won = true;
    session.status = 'finished';
    session.winnerId = player.id;
    session.activeTypingId = null;
  } else if (player.attempts >= session.maxGuesses) {
    player.eliminated = true;
  }

  return { won, exhausted: player.eliminated, statuses };
}

function buildHint(
  session: WordleSession
): { text: string; position?: number; letter?: string } | null {
  if (session.meaning && !session.meaningHintUsed) {
    return { text: `معنی کلمه: ${session.meaning}` };
  }

  const free: number[] = [];
  for (let i = 0; i < session.word.length; i++) {
    if (!session.revealed.has(i)) free.push(i);
  }
  if (free.length === 0) return null;

  const position = free[Math.floor(Math.random() * free.length)];
  return {
    text: `حرف ${faNum(position + 1)} کلمه «${session.word[position]}» است`,
    position,
    letter: session.word[position],
  };
}

async function awardPoints(ctx: Context, session: WordleSession): Promise<void> {
  const botId = (ctx as any).botId;

  for (const player of session.players) {
    if (player.awarded) continue;
    player.awarded = true;

    let amount = 0;
    let description = '';
    if (player.id === session.winnerId) {
      amount = Math.max(10, BASE_POINTS - player.hints * HINT_COST);
      description = 'بازی کلمه‌یاب — برنده';
    } else if (player.attempts >= 1) {
      amount = PARTICIPATION_POINTS;
      description = 'بازی کلمه‌یاب — شرکت';
    }
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
        data: { userId: user.id, amount, type: 'BONUS', description },
      });
    } catch {}
  }
}

async function deductHintPoints(ctx: Context, player: WordlePlayer): Promise<void> {
  try {
    const botId = (ctx as any).botId;
    const user = await prisma.user.findFirst({
      where: { telegramId: BigInt(player.id), botId },
    });
    if (!user || user.points < HINT_COST) return;

    await prisma.user.update({
      where: { id: user.id },
      data: { points: { decrement: HINT_COST } },
    });
    await prisma.pointTransaction.create({
      data: {
        userId: user.id,
        amount: -HINT_COST,
        type: 'BONUS',
        description: 'بازی کلمه‌یاب — خرید راهنما',
      },
    });
  } catch {}
}

// ─── Start Wordle ────────────────────────────
export async function handleWordle(ctx: Context) {
  if (!(await requireGroup(ctx, 'کلمه‌یاب'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (
    existing &&
    existing.status === 'playing' &&
    Date.now() - existing.createdAt < SESSION_TTL
  ) {
    await ctx.reply(
      '⏳ یک بازی کلمه‌یاب در حال انجام است — کلمه را در گروه بنویسید یا صبر کنید تا تمام شود.'
    );
    return;
  }

  const session = createSession(chatId);
  session.length = await getWordLength();
  session.ctx = ctx;
  sessions.set(key, session);

  const messageId = await sendGameMessage(ctx, key, buildText(session), {
    parse_mode: 'Markdown',
    ...buildKeyboard(session),
  });
  if (typeof messageId === 'number') session.messageId = messageId;
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
  session.ctx = ctx;

  const userId = ctx.from!.id;
  const userName = ctx.from!.first_name || 'بازیکن';

  // ── انتخاب حالت ──
  if (action.startsWith('wordle_mode_')) {
    await startRound(ctx, session, action.endsWith('daily') ? 'daily' : 'random');
    return;
  }

  // ── لغو ──
  if (action === 'wordle_cancel') {
    const isPlayer = findPlayer(session, userId);
    if (session.status === 'playing' && !isPlayer) {
      await ctx.answerCbQuery('❌ فقط بازیکنان می‌توانند بازی را لغو کنند.');
      return;
    }
    sessions.delete(key);
    void purgeGameMessages(ctx.telegram, key, GAME_CANCEL_PURGE_DELAY_MS);
    await ctx.answerCbQuery('بازی لغو شد.');
    try {
      await ctx.editMessageText('❌ بازی کلمه‌یاب لغو شد.');
    } catch {}
    return;
  }

  // ── بازی جدید ──
  if (action === 'wordle_new') {
    const fresh = createSession(chatId);
    fresh.messageId = 0;
    fresh.length = session.length;
    fresh.ctx = ctx;
    sessions.set(key, fresh);
    // تختهٔ قبلی پاک شده یا در نوبت پاک شدن است؛ برای دور تازه پیام تازه بفرست
    const reopened = await sendGameMessage(ctx, key, buildText(fresh), {
      parse_mode: 'Markdown',
      ...buildKeyboard(fresh),
    });
    if (typeof reopened === 'number') fresh.messageId = reopened;
    await ctx.answerCbQuery('🔄 حالت بازی را انتخاب کنید.');
    await refresh(fresh);
    return;
  }

  if (session.status !== 'playing') {
    await ctx.answerCbQuery('بازی تمام شده!');
    return;
  }

  const player = ensurePlayer(session, userId, userName);
  if (!player) {
    await ctx.answerCbQuery('❌ ظرفیت بازی پر است (حداکثر ۶ بازیکن).');
    return;
  }

  // ── راهنما ──
  if (action === 'wordle_hint') {
    if (player.eliminated) {
      await ctx.answerCbQuery('❌ تلاش‌هایت تمام شده است.');
      return;
    }
    if (player.hints >= MAX_HINTS) {
      await ctx.answerCbQuery(`❌ بیش از ${faNum(MAX_HINTS)} راهنما نمی‌توانی بگیری.`);
      return;
    }
    const hint = buildHint(session);
    if (!hint) {
      await ctx.answerCbQuery('❌ راهنمای دیگری در دسترس نیست.');
      return;
    }

    player.hints += 1;
    if (hint.text.startsWith('معنی')) session.meaningHintUsed = true;
    if (hint.position !== undefined && hint.letter) {
      session.revealed.set(hint.position, hint.letter);
    }
    session.hints.push({ playerId: player.id, name: player.name, text: hint.text });

    await deductHintPoints(ctx, player);
    await ctx.answerCbQuery(`💡 ${hint.text}`);
    await refresh(session);
    return;
  }

  // ── پاک کردن ──
  if (action === 'wordle_back') {
    player.buffer = player.buffer.slice(0, -1);
    session.activeTypingId = player.id;
    await ctx.answerCbQuery(player.buffer ? `کلمهٔ شما: ${player.buffer}` : 'پاک شد');
    await refresh(session);
    return;
  }

  // ── ثبت حدس ──
  if (action === 'wordle_submit') {
    if (player.buffer.length !== session.length) {
      await ctx.answerCbQuery(
        `❌ کلمه باید ${faNum(session.length)} حرف باشد (${faNum(player.buffer.length)} حرف نوشته‌ای).`
      );
      return;
    }
    const guess = player.buffer;
    const result = submitGuess(session, player, guess);
    session.activeTypingId = null;

    if (result.won) {
      await awardPoints(ctx, session);
      void purgeGameMessages(ctx.telegram, key, GAME_RESULT_PURGE_DELAY_MS);
      await ctx.answerCbQuery('🎉 آفرین! برنده شدی!');
      await refresh(session);
      return;
    }

    await ctx.answerCbQuery(
      result.exhausted
        ? `❌ تلاش‌هایت تمام شد. کلمه: ${session.word}`
        : `تلاش ${faNum(player.attempts)}/${faNum(session.maxGuesses)}`
    );
    await refresh(session);
    return;
  }

  // ── حرف ──
  if (action.startsWith('wordle_letter_')) {
    const letter = action.slice('wordle_letter_'.length);
    if (!letter || letter.length > 2) {
      await ctx.answerCbQuery('❌ حرف نامعتبر.');
      return;
    }
    if (player.eliminated) {
      await ctx.answerCbQuery('❌ تلاش‌هایت تمام شده است.');
      return;
    }
    if (player.buffer.length >= session.length) {
      await ctx.answerCbQuery('❌ کلمه پر است — اول ثبت یا پاک کن.');
      return;
    }
    player.buffer += letter;
    session.activeTypingId = player.id;
    await ctx.answerCbQuery(`کلمهٔ شما: ${player.buffer}`);
    await refresh(session);
    return;
  }
}

// ─── Start a round ───────────────────────────
async function startRound(
  ctx: Context,
  session: WordleSession,
  mode: 'daily' | 'random'
): Promise<void> {
  const length = await getWordLength();
  const pool = await loadWordPool(length);
  const entry =
    mode === 'daily' ? pickDailyWord(pool, session.dateKey) : pickRandomWord(pool);

  if (!entry) {
    await ctx.answerCbQuery('❌ بانک کلمات خالی است.');
    return;
  }

  session.mode = mode;
  session.word = entry.word;
  session.meaning = entry.meaning;
  session.length = entry.word.length;
  session.maxGuesses = MAX_GUESSES;
  session.players = [];
  session.rows = [];
  session.letterStates = new Map();
  session.revealed = new Map();
  session.hints = [];
  session.meaningHintUsed = false;
  session.winnerId = null;
  session.status = 'playing';
  session.activeTypingId = null;
  session.lastReplyAt = new Map();
  session.createdAt = Date.now();
  session.ctx = ctx;

  await ctx.answerCbQuery(
    mode === 'daily' ? '📅 کلمهٔ امروز آماده شد!' : '🎲 کلمهٔ تصادفی آماده شد!'
  );
  await refresh(session);
}

// ─── Direct text guess ───────────────────────
/**
 * حدس مستقیم: کاربر کلمه را در گروه می‌نویسد.
 * پیام‌های تک‌کلمه‌ای فارسی با طول درست، حدس بازی ثبت می‌شوند.
 */
export async function handleWordleText(ctx: Context, text: string): Promise<boolean> {
  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  const session = sessions.get(sessionKey(chatId));
  if (!session || session.status !== 'playing') return false;
  if (!(await isWordleEnabled())) return false;

  const raw = (text || '').trim();
  if (!raw) return false;

  // فقط پیام‌های تک‌کلمه‌ای معتبر بررسی می‌شوند (گفتگوی عادی گروه نادیده گرفته می‌شود)
  if (!/^[^\s]+$/.test(raw)) return false;

  const cleaned = raw.replace(/[.,!?؟،؛:؛\-–_"«»'`()[\]{}…]/g, '');
  if (!cleaned || /[^\u0600-\u06FF]/.test(cleaned)) return false;

  const guess = normalizeWord(cleaned);
  const userId = ctx.from!.id;
  const userName = ctx.from!.first_name || 'بازیکن';
  const known = findPlayer(session, userId);

  // طول اشتباه → فقط به بازیکنان ثبت‌شده پاسخ می‌دهیم (با فاصلهٔ زمانی)
  if (guess.length !== session.length) {
    if (!known) return false;
    const last = session.lastReplyAt.get(userId) || 0;
    if (Date.now() - last < REPLY_COOLDOWN) return true;
    session.lastReplyAt.set(userId, Date.now());
    await ctx.reply(
      `❌ کلمه باید ${faNum(session.length)} حرف باشد — ${faNum(guess.length)} حرف نوشته‌ای.`
    );
    return true;
  }

  const lastGuess = session.lastReplyAt.get(userId) || 0;
  if (Date.now() - lastGuess < GUESS_COOLDOWN) return true;
  session.lastReplyAt.set(userId, Date.now());

  const player = ensurePlayer(session, userId, userName);
  if (!player) {
    await ctx.reply('❌ ظرفیت بازی پر است (حداکثر ۶ بازیکن).');
    return true;
  }

  if (player.eliminated) {
    await ctx.reply('❌ تلاش‌هایت تمام شده — منتظر برنده بمان.');
    return true;
  }

  const result = submitGuess(session, player, guess);
  session.activeTypingId = null;

  if (result.won) {
    await awardPoints(ctx, session);
    void purgeGameMessages(ctx.telegram, sessionKey(chatId), GAME_RESULT_PURGE_DELAY_MS);
  }

  await refresh(session);
  return true;
}

// Cleanup expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(key);
    }
  }
}, 60000);
