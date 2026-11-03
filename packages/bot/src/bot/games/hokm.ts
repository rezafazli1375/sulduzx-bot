import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { requireGroup, checkGameChannelJoin } from './utils.js';
import {
  Card,
  Suit,
  SUIT_EMOJI,
  SUIT_NAME_FA,
  TRICK_POINTS_TO_WIN,
  TOTAL_TRICKS,
  cardLabel,
  dealHokmHands,
  sortHand,
  findAceHolder,
  teamOf,
  isTrickComplete,
  canPlayCard,
  determineTrickWinner,
  chooseBotCard,
  shuffle,
} from './hokm-logic.js';

// ─── Types ───────────────────────────────────
/**
 * هر بازیکن یک صندلی از میز است.
 * id = null یعنی صندلی خالی که با ربات پر می‌شود.
 * دستِ هیچ بازیکنی هرگز در پیام گروه نمایش داده نمی‌شود.
 */
interface HokmPlayer {
  id: number | null;
  name: string;
  hand: Card[];
  /** دست اولیهٔ پخش‌شده (فقط در پایان بازی برای همه افشا می‌شود) */
  initialHand: Card[];
  tricks: number;
  isBot: boolean;
  /** شناسهٔ پیام خصوصیِ دست این بازیکن (در گفتگوی خصوصی با ربات) */
  dmMessageId: number | null;
  /** امضای آخرین محتوای ارسال‌شده در گفتگوی خصوصی (برای جلوگیری از پیام تکراری) */
  dmSignature: string | null;
}

interface HokmSession {
  chatId: number;
  messageId: number;
  players: HokmPlayer[];
  hostId: number;
  currentPlayer: number;
  trumpSuit: Suit | null;
  rulerSeat: number;
  currentTrick: { seat: number; card: Card | null }[];
  status: 'waiting' | 'bidding' | 'playing' | 'finished';
  teamScores: [number, number];
  lastWinnerSeat: number | null;
  result: { winnerTeam: 0 | 1; kot: boolean; su: boolean } | null;
  /** پیام‌های هشدار برای نمایش روی میز بازی */
  notices: string[];
  busy: boolean;
  /** آخرین متنی که روی میز بازی (پیام گروه) نمایش داده شده */
  boardSignature: string | null;
  createdAt: number;
}

const SEAT_COUNT = 4;

const sessions = new Map<string, HokmSession>();

function sessionKey(chatId: number): string {
  return `hokm:${chatId}`;
}

function emptyTrick(): { seat: number; card: Card | null }[] {
  return [0, 1, 2, 3].map((seat) => ({ seat, card: null }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Helpers ─────────────────────────────────
/** بازی فعالِ یک کاربر (کلیک از گفتگوی خصوصی همیشه به این نیاز دارد) */
function findSessionByUser(userId: number): HokmSession | undefined {
  for (const session of sessions.values()) {
    if (session.status === 'finished') continue;
    if (session.players.some((p) => p.id === userId)) return session;
  }
  return undefined;
}

function seatOf(session: HokmSession, userId: number): number {
  return session.players.findIndex((p) => p.id === userId);
}

/** فرار دادن کاراکترهای حساس Markdown تلگرام از نام بازیکن */
function escapeMd(text: string): string {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

function playerName(player: HokmPlayer, withMention = true): string {
  if (player.isBot || !player.id) return `🤖 ${escapeMd(player.name)}`;
  const label = escapeMd(player.name);
  return withMention ? `[${label}](tg://user?id=${player.id})` : label;
}

function teamTitle(session: HokmSession, seat: number): string {
  return teamOf(seat) === 0 ? 'تیم شما' : 'تیم مقابل';
}

function humanCount(session: HokmSession): number {
  return session.players.filter((p) => !p.isBot && p.id !== null).length;
}

// ─── Group board (public) ─────────────────────
/** پیام گروه = میز بازی. هیچ‌وقت دستِ کسی در این پیام نشان داده نمی‌شود. */
function buildHokmText(session: HokmSession): string {
  const lines: string[] = [];
  lines.push('🃏 *بازی حکم*');
  lines.push('');

  if (session.status === 'waiting') {
    lines.push('👥 *میز بازی (۴ صندلی):*');
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const p = session.players[seat];
      const occupied = p.id !== null || p.isBot;
      lines.push(
        occupied ? `• صندلی ${seat + 1}: ${playerName(p)}` : `• صندلی ${seat + 1}: _— خال —_`
      );
    }
    lines.push('');
    lines.push(
      `🎮 بازیکنان آماده: ${humanCount(session)} از ۴ (صندلی‌های خالی را ربات پر می‌کند)`
    );
    lines.push('');
    lines.push('📋 *قوانین استاندارد حکم:*');
    lines.push('• ۵۲ کارت؛ هر نفر ۱۳ کارت (پخش ۵-۴-۴)');
    lines.push(
      '• یک خال به‌عنوان «حکم» انتخاب می‌شود؛ دارندهٔ اَس حکم، **حاکم** می‌شود و اول بازی می‌کند'
    );
    lines.push(
      '• باید خال خواسته‌شده را بازی کنید؛ اگر نداشتید، هر کارتی (حتی حکم) مجاز است'
    );
    lines.push('• حکم بر همهٔ خال‌ها می‌زند؛ برندهٔ هر تریک، تریک بعدی را شروع می‌کند');
    lines.push(`• تیمی که ${TRICK_POINTS_TO_WIN} تریک بگیرد برندهٔ بازی است`);
    lines.push('• کوت: تیمی که هیچ تریکی نگیرد، دو برابر باخت');
    lines.push('• سو: بازیکنی که هر ۱۳ تریک را بگیرد');
    lines.push('');
    lines.push(
      '🔒 *کارت‌های شما محرمانه است:* دست شما فقط در **گفتگوی خصوصی** با ربات فرستاده می‌شود و هیچ بازیکن دیگری آن را نمی‌بیند.'
    );
    lines.push('');
    lines.push(
      '🎯 برای شرکت دکمهٔ «🎮 نشستن روی صندلی» را بزنید؛ سپس میزبان «▶️ شروع بازی» را می‌زند.'
    );
    return lines.join('\n');
  }

  // ── بازی در جریان / پایان‌یافته ──
  lines.push('👥 *میز بازی:*');
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const p = session.players[seat];
    lines.push(
      `• صندلی ${seat + 1} (${teamTitle(session, seat)}): ${playerName(p)} — 🂠 ${p.hand.length} کارت · ${p.tricks} تریک`
    );
  }
  lines.push('');
  lines.push(
    `🎴 *خال حکم:* ${session.trumpSuit ? SUIT_EMOJI[session.trumpSuit] + ' ' + SUIT_NAME_FA[session.trumpSuit] : '—'}`
  );
  lines.push(`👑 *حاکم:* ${playerName(session.players[session.rulerSeat])}`);
  lines.push(`📊 *تریک‌ها:* تیم شما ${session.teamScores[0]} | تیم مقابل ${session.teamScores[1]}`);
  lines.push('');

  if (session.notices.length) {
    for (const notice of session.notices) lines.push(notice);
    lines.push('');
  }

  if (session.status === 'bidding') {
    lines.push('🎯 *میزبان* باید خال حکم را انتخاب کند.');
    lines.push('');
    lines.push('🔒 دست شما در گفتگوی خصوصی با ربات است.');
    return lines.join('\n');
  }

  if (session.status === 'finished' && session.result) {
    const hostSeat = seatOf(session, session.hostId);
    const humanTeam = hostSeat >= 0 ? teamOf(hostSeat) : 0;
    const humanWon = session.result.winnerTeam === humanTeam;
    lines.push('🏆 *بازی تمام شد!*');
    lines.push('');
    lines.push(humanWon ? '🎉 *تیم شما برنده شد!*' : '😔 *تیم شما باخت!*');
    if (session.result.kot) {
      lines.push('🃏 *کوت!* تیم مقابل هیچ تریکی نگرفت — دو برابر باخت.');
    }
    if (session.result.su) {
      lines.push('🎊 *سو!* یک بازیکن تمام ۱۳ تریک را گرفت.');
    }
    if (humanWon) {
      const points = session.result.kot ? 120 : session.result.su ? 100 : 60;
      lines.push(`⭐️ ${points} امتیاز دریافت شد!`);
    }
    lines.push('');
    lines.push('🂠 *تریک هر بازیکن:*');
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      lines.push(`• ${playerName(session.players[seat])}: ${session.players[seat].tricks} تریک`);
    }
    lines.push('');
    lines.push('🃏 *دست‌های پایان بازی (افشا شد):*');
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const p = session.players[seat];
      const reveal = p.initialHand.length ? p.initialHand : p.hand;
      lines.push(
        `• صندلی ${seat + 1} ${playerName(p)}: ${sortHand(reveal).map((c) => cardLabel(c)).join(' ') || '—'}`
      );
    }
    return lines.join('\n');
  }

  // ── در حال بازی ──
  lines.push('🎴 *تریک جاری:*');
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const played = session.currentTrick[seat]?.card;
    lines.push(`• ${playerName(session.players[seat])}: ${played ? cardLabel(played) : '—'}`);
  }
  lines.push('');
  lines.push(`👤 *نوبت:* ${playerName(session.players[session.currentPlayer])}`);

  const hostSeat = seatOf(session, session.hostId);
  if (hostSeat >= 0 && session.currentPlayer === hostSeat) {
    lines.push('📨 کارت‌های شما را در گفتگوی خصوصی با ربات باز کنید.');
  } else {
    lines.push('🔒 دست هر بازیکن فقط در گفتگوی خصوصی خودش دیده می‌شود.');
  }

  return lines.join('\n');
}

// ─── Private hand (DM) ────────────────────────
function buildHokmPrivateText(session: HokmSession, seat: number): string {
  const player = session.players[seat];
  const myTeam = teamOf(seat);
  const otherTeam = myTeam === 0 ? 1 : 0;
  const partner = session.players[(seat + 2) % SEAT_COUNT];

  const lines: string[] = [];
  lines.push('🃏 *بازی حکم — دست خصوصی شما*');
  lines.push('');
  lines.push('🔒 این پیام فقط برای شماست. بازیکنان دیگر دست شما را نمی‌بینند.');
  lines.push('');
  lines.push(
    `🎴 *خال حکم:* ${session.trumpSuit ? SUIT_EMOJI[session.trumpSuit] + ' ' + SUIT_NAME_FA[session.trumpSuit] : '—'}`
  );
  lines.push(`👑 *حاکم:* ${playerName(session.players[session.rulerSeat], false)}`);
  lines.push(`🪑 *هم‌تیمی شما:* ${playerName(partner, false)}`);
  lines.push(`📊 *تریک‌ها:* تیم شما ${session.teamScores[myTeam]} | تیم مقابل ${session.teamScores[otherTeam]}`);
  lines.push('');
  lines.push(`🂠 *دست شما (${player.hand.length} کارت):*`);
  lines.push(sortHand(player.hand).map((c) => cardLabel(c)).join(' ') || '—');
  lines.push('');

  if (session.currentPlayer === seat) {
    const led = session.currentTrick.find((t) => t.card !== null)?.card;
    if (led) {
      lines.push(`⚠️ باید ${SUIT_NAME_FA[led.suit]} بازی کنید (خال خواسته‌شده).`);
    } else {
      lines.push('✅ *نوبت شماست!* کارت خود را انتخاب کنید.');
    }
  } else {
    lines.push(`⏳ نوبت «${playerName(session.players[session.currentPlayer], false)}» است — منتظر بمانید.`);
  }

  return lines.join('\n');
}

function buildHokmPrivateKeyboard(session: HokmSession, seat: number): any {
  const keyboard: any[][] = [];
  const player = session.players[seat];

  if (session.status === 'playing' && session.currentPlayer === seat) {
    const playable = player.hand.filter((card) =>
      canPlayCard(card, player.hand, session.currentTrick, session.trumpSuit)
    );

    if (playable.length === 0) {
      keyboard.push([Markup.button.callback('❌ کارت قانونی ندارید', 'hokm_wait')]);
    } else {
      const cardButtons = playable.map((card) =>
        Markup.button.callback(cardLabel(card), `hokm_play_${card.suit}_${card.rank}`)
      );
      for (let i = 0; i < cardButtons.length; i += 4) {
        keyboard.push(cardButtons.slice(i, i + 4));
      }
    }
  }

  keyboard.push([Markup.button.callback('🔄 به‌روزرسانی دست', 'hokm_resend')]);
  return Markup.inlineKeyboard(keyboard);
}

// ─── Group keyboard ───────────────────────────
function buildHokmKeyboard(session: HokmSession): any {
  if (session.status === 'waiting') {
    const full = humanCount(session) >= SEAT_COUNT;
    const rows: any[][] = [];
    if (full) {
      rows.push([Markup.button.callback('♟️ میز کامل است', 'hokm_wait')]);
    } else {
      rows.push([Markup.button.callback('🎮 نشستن روی صندلی', 'hokm_join')]);
      rows.push([Markup.button.callback('🚪 خروج از بازی', 'hokm_leave')]);
    }
    rows.push([Markup.button.callback('▶️ شروع بازی', 'hokm_start')]);
    rows.push([Markup.button.callback('❌ لغو', 'hokm_cancel')]);
    return Markup.inlineKeyboard(rows);
  }

  if (session.status === 'bidding') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('❤️ حکم دل', 'hokm_trump_hearts'),
        Markup.button.callback('♦️ حکم خشت', 'hokm_trump_diamonds'),
      ],
      [
        Markup.button.callback('♣️ حکم خاج', 'hokm_trump_clubs'),
        Markup.button.callback('♠️ حکم پیک', 'hokm_trump_spades'),
      ],
    ]);
  }

  if (session.status === 'finished') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🔄 بازی جدید', 'hokm_new')],
      [Markup.button.callback('🎙 منوی بازی', 'games')],
    ]);
  }

  return Markup.inlineKeyboard([
    [Markup.button.callback('🔄 به‌روزرسانی', 'hokm_resend')],
    [Markup.button.callback('❌ لغو بازی', 'hokm_cancel')],
  ]);
}

// ─── Start Hokm ──────────────────────────────
export async function handleHokm(ctx: Context) {
  if (!(await requireGroup(ctx, 'حکم'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < 1800000) {
    await ctx.reply('⏳ یک بازی حکم در حال انجام است. لطفاً صبر کنید تا تمام شود.');
    return;
  }

  const fromUser = ctx.from!;
  const session: HokmSession = {
    chatId,
    messageId: 0,
    players: [
      { id: fromUser.id, name: fromUser.first_name || 'میزبان', hand: [], initialHand: [], tricks: 0, isBot: false, dmMessageId: null, dmSignature: null },
      { id: null, name: 'بازیکن ۲', hand: [], initialHand: [], tricks: 0, isBot: false, dmMessageId: null, dmSignature: null },
      { id: null, name: 'بازیکن ۳', hand: [], initialHand: [], tricks: 0, isBot: false, dmMessageId: null, dmSignature: null },
      { id: null, name: 'بازیکن ۴', hand: [], initialHand: [], tricks: 0, isBot: false, dmMessageId: null, dmSignature: null },
    ],
    hostId: fromUser.id,
    currentPlayer: 0,
    trumpSuit: null,
    rulerSeat: 0,
    currentTrick: emptyTrick(),
    status: 'waiting',
    teamScores: [0, 0],
    lastWinnerSeat: null,
    result: null,
    notices: [],
    busy: false,
    boardSignature: null,
    createdAt: Date.now(),
  };
  sessions.set(key, session);

  const msg = await ctx.reply(buildHokmText(session), {
    parse_mode: 'Markdown',
    ...buildHokmKeyboard(session),
  });

  session.messageId = msg.message_id;
}

// ─── Action Handler ──────────────────────────
export async function handleHokmAction(ctx: Context) {
  const action = (ctx.callbackQuery as any).data as string;
  const userId = ctx.from!.id;

  // کلیک از گفتگوی خصوصی است → بازی از روی کاربر پیدا می‌شود
  let session = sessions.get(sessionKey(ctx.chat!.id));
  if (!session) session = findSessionByUser(userId);

  if (!session) {
    await ctx.answerCbQuery('⏰ بازی منقضی شده یا وجود ندارد.');
    return;
  }

  // ── لغو ──
  if (action === 'hokm_cancel') {
    if (userId !== session.hostId) {
      await ctx.answerCbQuery('❌ فقط میزبان می‌تواند بازی را لغو کند.');
      return;
    }
    sessions.delete(sessionKey(session.chatId));
    await ctx.answerCbQuery('بازی لغو شد.');
    await editGroupBoard(ctx, session, '❌ بازی حکم لغو شد.');
    return;
  }

  // ── بازی جدید ──
  if (action === 'hokm_new') {
    if (userId !== session.hostId) {
      await ctx.answerCbQuery('❌ فقط میزبان می‌تواند بازی جدید بسازد.');
      return;
    }
    session.players = [
      { id: session.hostId, name: 'میزبان', hand: [], initialHand: [], tricks: 0, isBot: false, dmMessageId: null, dmSignature: null },
      { id: null, name: 'بازیکن ۲', hand: [], initialHand: [], tricks: 0, isBot: false, dmMessageId: null, dmSignature: null },
      { id: null, name: 'بازیکن ۳', hand: [], initialHand: [], tricks: 0, isBot: false, dmMessageId: null, dmSignature: null },
      { id: null, name: 'بازیکن ۴', hand: [], initialHand: [], tricks: 0, isBot: false, dmMessageId: null, dmSignature: null },
    ];
    session.trumpSuit = null;
    session.rulerSeat = 0;
    session.currentPlayer = 0;
    session.currentTrick = emptyTrick();
    session.teamScores = [0, 0];
    session.lastWinnerSeat = null;
    session.result = null;
    session.notices = [];
    session.busy = false;
    session.boardSignature = null;
    session.status = 'waiting';

    await ctx.answerCbQuery('🔄 بازی جدید آماده شد!');
    await syncAll(ctx, session);
    return;
  }

  if (action === 'hokm_wait') {
    await ctx.answerCbQuery('⏳ لطفاً صبر کنید...');
    return;
  }

  // ── نشستن روی صندلی ──
  if (action === 'hokm_join') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (seatOf(session, userId) >= 0) {
      await ctx.answerCbQuery('شما قبلاً روی صندلی نشسته‌اید!');
      return;
    }
    if (humanCount(session) >= SEAT_COUNT) {
      await ctx.answerCbQuery('❌ میز کامل است.');
      return;
    }

    // دست بازیکن باید در گفتگوی خصوصی دریافت شود ⇒ اول DM تست می‌شود
    if (!(await verifyPrivateChannel(ctx, userId))) {
      await ctx.answerCbQuery(
        '❌ اول باید در گفتگوی خصوصی با ربات گفتگو کنید (دکمهٔ «🤖 گفتگوی خصوصی» در همین پیام).',
        { show_alert: true }
      );
      await addPrivateChatButton(ctx, session);
      return;
    }

    const freeSeat = session.players.findIndex((p) => p.id === null && !p.isBot);
    session.players[freeSeat] = {
      id: userId,
      name: ctx.from!.first_name || 'بازیکن',
      hand: [],
      initialHand: [],
      tricks: 0,
      isBot: false,
      dmMessageId: null,
      dmSignature: null,
    };

    await ctx.answerCbQuery('🎮 روی صندلی نشستید!');
    await syncAll(ctx, session);
    return;
  }

  // ── خروج از بازی ──
  if (action === 'hokm_leave') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی شروع شده و نمی‌توانید خارج شوید.');
      return;
    }
    const seat = seatOf(session, userId);
    if (seat <= 0) {
      await ctx.answerCbQuery('❌ میزبان نمی‌تواند از بازی خارج شود.');
      return;
    }
    if (seat < 0) {
      await ctx.answerCbQuery('شما در این بازی نیستید.');
      return;
    }
    session.players[seat] = {
      id: null,
      name: `بازیکن ${seat + 1}`,
      hand: [],
      initialHand: [],
      tricks: 0,
      isBot: false,
      dmMessageId: null,
      dmSignature: null,
    };
    await ctx.answerCbQuery('🚪 از بازی خارج شدید.');
    await syncAll(ctx, session);
    return;
  }

  // ── شروع بازی ──
  if (action === 'hokm_start') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (userId !== session.hostId) {
      await ctx.answerCbQuery('❌ فقط میزبان می‌تواند بازی را شروع کند.');
      return;
    }

    seatPlayers(session);

    const hands = dealHokmHands();
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      session.players[seat].hand = hands[seat];
      session.players[seat].initialHand = [...hands[seat]];
      session.players[seat].tricks = 0;
    }

    session.status = 'bidding';
    session.currentTrick = emptyTrick();
    session.notices = [];

    // ارسال دستِ هر بازیکن در گفتگوی خصوصی
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const player = session.players[seat];
      if (player.isBot || !player.id) continue;

      const ok = await sendPrivateHand(ctx, session, seat);
      if (!ok) {
        session.notices.push(`⚠️ دستِ ${playerName(player)} قابل ارسال نبود؛ ربات جای او نشست.`);
        player.isBot = true;
        player.id = null;
        player.dmMessageId = null;
        player.name = 'ربات';
      }
    }

    await ctx.answerCbQuery('🎴 کارت‌ها پخش شد! خال حکم را انتخاب کنید.');
    await syncAll(ctx, session);
    return;
  }

  // ── انتخاب خال حکم ──
  if (action.startsWith('hokm_trump_')) {
    if (session.status !== 'bidding') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (userId !== session.hostId) {
      await ctx.answerCbQuery('❌ فقط میزبان می‌تواند حکم را انتخاب کند.');
      return;
    }

    const suit = action.replace('hokm_trump_', '') as Suit;
    session.trumpSuit = suit;

    // دارندهٔ اَس حکم، حاکم می‌شود و بازی را شروع می‌کند
    const aceSeat = findAceHolder(session.players.map((p) => p.hand), suit);
    session.rulerSeat = aceSeat;
    session.currentPlayer = aceSeat;
    session.currentTrick = emptyTrick();
    session.status = 'playing';

    const ruler = session.players[aceSeat];
    await ctx.answerCbQuery(`🎯 حکم: ${SUIT_EMOJI[suit]} — حاکم: ${ruler.name}`);
    await syncAll(ctx, session);

    if (ruler.isBot) {
      await playBotTurns(ctx, session);
    }
    return;
  }

  // ── به‌روزرسانی دست خصوصی ──
  if (action === 'hokm_resend') {
    const seat = seatOf(session, userId);
    if (seat < 0) {
      await ctx.answerCbQuery('⏰ بازی منقضی شده یا وجود ندارد.');
      return;
    }
    if (session.players[seat].isBot) {
      await ctx.answerCbQuery('🤖 شما در این بازی ربات هستید.');
      return;
    }
    await ctx.answerCbQuery('🔄 دست شما به‌روز شد.');
    await sendPrivateHand(ctx, session, seat);
    return;
  }

  // ── بازی کردن کارت (از گفتگوی خصوصی) ──
  if (action.startsWith('hokm_play_')) {
    if (session.status !== 'playing') {
      await ctx.answerCbQuery('⏳ بازی هنوز شروع نشده!');
      return;
    }

    const seat = seatOf(session, userId);
    if (seat < 0) {
      await ctx.answerCbQuery('❌ شما بازیکن این بازی نیستید!');
      return;
    }
    if (session.currentPlayer !== seat) {
      await ctx.answerCbQuery('⏳ نوبت شما نیست!');
      return;
    }

    const [, , suitStr, rankStr] = action.split('_');
    const suit = suitStr as Suit;
    const rank = parseInt(rankStr, 10);

    const player = session.players[seat];
    const card = player.hand.find((c) => c.suit === suit && c.rank === rank);
    if (!card) {
      await ctx.answerCbQuery('❌ این کارت در دست شما نیست.');
      return;
    }

    if (!canPlayCard(card, player.hand, session.currentTrick, session.trumpSuit)) {
      const led = session.currentTrick.find((t) => t.card !== null)?.card;
      await ctx.answerCbQuery(
        led ? `❌ باید ${SUIT_NAME_FA[led.suit]} بازی کنید.` : '❌ این کارت قابل بازی نیست.'
      );
      return;
    }

    player.hand = player.hand.filter((c) => !(c.suit === card.suit && c.rank === card.rank));
    session.currentTrick[seat].card = card;

    await ctx.answerCbQuery(`🃏 ${cardLabel(card)} بازی شد`);
    await continueAfterCard(ctx, session);
    return;
  }
}

// ─── Private channel helpers ──────────────────
async function verifyPrivateChannel(ctx: Context, userId: number): Promise<boolean> {
  try {
    await ctx.telegram.sendMessage(
      userId.toString(),
      '🃏 *بازی حکم*\n\n' +
        '🔒 کارت‌های شما فقط در همین گفتگوی خصوصی ارسال می‌شود؛ هیچ بازیکن دیگری دست شما را نمی‌بیند.\n' +
        '✅ آماده‌اید!'
    );
    return true;
  } catch {
    return false;
  }
}

async function sendPrivateHand(ctx: Context, session: HokmSession, seat: number): Promise<boolean> {
  const player = session.players[seat];
  if (!player.id) return false;

  const text = buildHokmPrivateText(session, seat);
  const extra = {
    parse_mode: 'Markdown',
    ...buildHokmPrivateKeyboard(session, seat),
  };

  // اگر محتوا نسبت به آخرین ارسال تغییری نکرده، دوباره پیام نفرست
  const signature = text + JSON.stringify(extra.reply_markup);
  if (player.dmSignature === signature) return true;

  try {
    if (player.dmMessageId) {
      await ctx.telegram.editMessageText(
        player.id.toString(),
        player.dmMessageId,
        undefined,
        text,
        extra
      );
    } else {
      const sent = await ctx.telegram.sendMessage(player.id.toString(), text, extra);
      player.dmMessageId = sent.message_id;
    }
    player.dmSignature = signature;
    return true;
  } catch {
    return false;
  }
}

async function addPrivateChatButton(ctx: Context, session: HokmSession): Promise<void> {
  try {
    const me = await ctx.telegram.getMe();
    const rows: any[][] = [];
    if (humanCount(session) < SEAT_COUNT) {
      rows.push([Markup.button.callback('🎮 نشستن روی صندلی', 'hokm_join')]);
    }
    rows.push([Markup.button.url('🤖 گفتگوی خصوصی با ربات', `https://t.me/${me.username}`)]);
    rows.push([Markup.button.callback('▶️ شروع بازی', 'hokm_start')]);
    rows.push([Markup.button.callback('❌ لغو', 'hokm_cancel')]);

    await ctx.telegram.editMessageText(
      session.chatId.toString(),
      session.messageId,
      undefined,
      buildHokmText(session),
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
    );
    session.boardSignature = null;
  } catch {}
}

// ─── Game flow ───────────────────────────────
/** نشاندن بازیکنان واقعی روی صندلی‌ها (۰ = میزبان) و پر کردن بقیه با ربات */
function seatPlayers(session: HokmSession): void {
  const host = session.players.find((p) => p.id === session.hostId) ?? session.players[0];
  const others = session.players.filter(
    (p) => !p.isBot && p.id !== null && p.id !== session.hostId
  );

  const slots = shuffle([1, 2, 3]);
  const seated: (HokmPlayer | null)[] = [host, null, null, null];
  others.forEach((p, i) => {
    if (i < slots.length) seated[slots[i]] = p;
  });

  session.players = seated.map((p) => {
    if (p) return { ...p, hand: [], initialHand: [], tricks: 0, dmMessageId: null, dmSignature: null };
    return {
      id: null,
      name: 'ربات',
      hand: [],
      initialHand: [],
      tricks: 0,
      isBot: true,
      dmMessageId: null,
      dmSignature: null,
    };
  });
}

async function continueAfterCard(ctx: Context, session: HokmSession) {
  if (isTrickComplete(session.currentTrick)) {
    await completeTrick(ctx, session);
  } else {
    session.currentPlayer = (session.currentPlayer + 1) % SEAT_COUNT;
    await syncAll(ctx, session);
  }

  if (session.status === 'playing' && session.players[session.currentPlayer].isBot) {
    await playBotTurns(ctx, session);
  }
}

async function playBotTurns(ctx: Context, session: HokmSession) {
  while (
    session.status === 'playing' &&
    !session.busy &&
    session.players[session.currentPlayer].isBot
  ) {
    session.busy = true;
    try {
      const seat = session.currentPlayer;
      const bot = session.players[seat];
      const card = chooseBotCard(bot.hand, session.currentTrick, session.trumpSuit!, seat);

      bot.hand = bot.hand.filter((c) => !(c.suit === card.suit && c.rank === card.rank));
      session.currentTrick[seat].card = card;

      if (isTrickComplete(session.currentTrick)) {
        await completeTrick(ctx, session);
      } else {
        session.currentPlayer = (session.currentPlayer + 1) % SEAT_COUNT;
        await syncAll(ctx, session);
      }

      await sleep(900);
    } finally {
      session.busy = false;
    }
  }
}

async function completeTrick(ctx: Context, session: HokmSession) {
  const winnerSeat = determineTrickWinner(session.currentTrick, session.trumpSuit!);
  const winner = session.players[winnerSeat];
  const team = teamOf(winnerSeat);

  winner.tricks++;
  session.teamScores[team]++;
  session.lastWinnerSeat = winnerSeat;

  if (session.teamScores[team] >= TRICK_POINTS_TO_WIN) {
    const losingTeam = team === 0 ? 1 : 0;
    const su = winner.tricks >= TOTAL_TRICKS;
    const kot = session.teamScores[losingTeam] === 0;

    session.status = 'finished';
    session.result = { winnerTeam: team, kot, su };

    await awardHokmPoints(ctx, session);
    await syncAll(ctx, session);
    return;
  }

  session.currentTrick = emptyTrick();
  session.currentPlayer = winnerSeat;

  await syncAll(ctx, session);
}

async function awardHokmPoints(ctx: Context, session: HokmSession) {
  if (!session.result) return;

  const winnerTeam = session.result.winnerTeam;
  const points = session.result.kot ? 120 : session.result.su ? 100 : 60;

  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const player = session.players[seat];
    if (player.isBot || !player.id) continue;
    if (teamOf(seat) !== winnerTeam) continue;

    try {
      const user = await prisma.user.findFirst({
        where: { telegramId: BigInt(player.id), botId: (ctx as any).botId },
      });
      if (!user) continue;

      await prisma.user.update({
        where: { id: user.id },
        data: { points: { increment: points } },
      });
      await prisma.pointTransaction.create({
        data: {
          userId: user.id,
          amount: points,
          type: 'BONUS',
          description: 'بازی حکم — برنده',
        },
      });
    } catch {}
  }
}

// ─── Rendering ────────────────────────────────
/** به‌روزرسانی میز بازی (گروه) و دست‌های خصوصی همهٔ بازیکنان */
async function syncAll(ctx: Context, session: HokmSession): Promise<void> {
  await editGroupBoard(ctx, session);
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const player = session.players[seat];
    if (player.isBot || !player.id) continue;
    await sendPrivateHand(ctx, session, seat);
  }
}

async function editGroupBoard(
  ctx: Context,
  session: HokmSession,
  overrideText?: string
): Promise<void> {
  const text = overrideText ?? buildHokmText(session);
  const keyboard = buildHokmKeyboard(session);
  const signature = text + JSON.stringify(keyboard.reply_markup);

  // اگر متن و دکمه‌ها تغییری نکرده‌اند، دوباره ویرایش نفرست
  if (!overrideText && session.boardSignature === signature) return;

  try {
    await ctx.telegram.editMessageText(
      session.chatId.toString(),
      session.messageId,
      undefined,
      text,
      {
        parse_mode: 'Markdown',
        ...keyboard,
      }
    );
    session.boardSignature = overrideText ? null : signature;
  } catch {}
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
