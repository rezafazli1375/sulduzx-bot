import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import {
  GAME_CANCEL_PURGE_DELAY_MS,
  GAME_RESULT_PURGE_DELAY_MS,
  checkGameChannelJoin,
  deleteGameMessage,
  postGameMessage,
  purgeGameMessages,
  requireGroup,
  sendGameMessage,
  trackGameMessage,
} from './utils.js';
import {
  Card,
  Meld,
  MAX_SEATS,
  MIN_SEATS,
  OPEN_POINTS,
  TARGET_POINTS,
  applyLayOff,
  canLayOff,
  cardLabel,
  chooseBotDiscard,
  dealScala,
  findLayoffs,
  handLabels,
  isDiscardAllowed,
  penaltyTotal,
  pickBestMelds,
  resolveMeld,
  sortHand,
} from './scala-logic.js';

// ─── Types ───────────────────────────────────
/**
 * میز اسکالا (Scala Quaranta).
 * دست هر بازیکن فقط در گفتگوی خصوصیِ خودش با ربات نمایش داده می‌شود؛
 * در گروه فقط لابی و پیام نتیجه می‌ماند (همان الگوی بازی حکم).
 */
interface ScalaPlayer {
  id: number | null;
  name: string;
  hand: Card[];
  isBot: boolean;
  /** مجموع امتیازهای کیفریِ دست‌های تمام‌شده */
  score: number;
  /** از ۱۰۱ گذشته و از مسابقه خارج شده */
  retired: boolean;
  /** آیا «باز» شده (مخل ۴۰ امتیازی روی میز گذاشته) */
  hasOpened: boolean;
  dmMessageId: number | null;
  dmSignature: string | null;
}

type ScalaPhase = 'draw' | 'meld' | 'discard';

interface ScalaSession {
  chatId: number;
  messageId: number;
  hostId: number;
  hostName: string;
  seatCount: number;
  mode: 'single' | 'match';
  status: 'waiting' | 'playing' | 'handover' | 'finished';
  players: ScalaPlayer[];
  /** مخل‌های عمومی روی میز — همه می‌توانند به آن‌ها کارت اضافه کنند */
  table: Meld[];
  stock: Card[];
  discard: Card[];
  turn: number;
  phase: ScalaPhase;
  /** کارت‌های انتخاب‌شده برای مخل (شناسه) */
  selected: number[];
  /** جایکر یا کارتِ مخلفاتی که باید همین نوبت مصرف/دورریخته شود */
  takenFromDiscard: Card | null;
  owedJoker: Card | null;
  jokerWarned: boolean;
  /** مخل‌هایی که این بازیکن همین نوبت گذاشته (برای شمارش opening و پس‌گرفتن) */
  turnMeldPoints: number;
  turnMelds: Meld[];
  handNumber: number;
  turnNumber: number;
  firstTurnSeat: number;
  closedBy: number | null;
  lastHand: { seat: number | null; penalties: number[] } | null;
  winner: number | null;
  notices: string[];
  busy: boolean;
  boardSignature: string | null;
  boardCleared: boolean;
  createdAt: number;
}

/** امتیاز ربات: هر دست بسته‌شده + برندهٔ مسابقه */
const POINTS_PER_HAND = 20;
const POINTS_MATCH_WIN = 100;

const sessions = new Map<string, ScalaSession>();

function sessionKey(chatId: number): string {
  return `scala:${chatId}`;
}

/** برای هارنس تست: دیدن وضعیت داخلی یک میز */
export function peekScalaSession(chatId: number): ScalaSession | undefined {
  return sessions.get(sessionKey(chatId));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** کلیک از گفتگوی خصوصی: بازی از روی کاربر پیدا می‌شود */
function findSessionByUser(userId: number): ScalaSession | undefined {
  let finished: ScalaSession | undefined;
  for (const session of sessions.values()) {
    if (!session.players.some((p) => p.id === userId)) continue;
    if (session.status === 'finished') {
      finished ??= session;
      continue;
    }
    return session;
  }
  return finished;
}

function seatOf(session: ScalaSession, userId: number): number {
  return session.players.findIndex((p) => p.id === userId);
}

function escapeMd(text: string): string {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

function playerName(player: ScalaPlayer, withMention = true): string {
  if (player.isBot || !player.id) return `🤖 ${escapeMd(player.name)}`;
  const label = escapeMd(player.name);
  return withMention ? `[${label}](tg://user?id=${player.id})` : label;
}

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

function faNum(value: number): string {
  return String(value)
    .replace('-', '')
    .split('')
    .map((d) => FA_DIGITS[Number(d)] ?? d)
    .join('');
}

/** صندلی‌های در بازی ماندگار (خارج‌شدنی‌ها بدهی ندارند ولی نوبت هم نمی‌گیرند) */
function activeSeats(session: ScalaSession): number[] {
  return session.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.retired)
    .map(({ i }) => i);
}

function humanCount(session: ScalaSession): number {
  return session.players.filter((p) => !p.isBot && p.id !== null).length;
}

function actor(session: ScalaSession): ScalaPlayer {
  return session.players[session.turn];
}

/** آیا بازیکن می‌تواند همین حالا بازی را ببندد؟ (دستش یک کارت شده باشد) */
function canClose(session: ScalaSession): boolean {
  const player = actor(session);
  if (player.hand.length !== 1) return false;
  if (player.retired || player.isBot) return false;
  if (!player.hasOpened) return false;
  return session.turnNumber > 1;
}

// ─── Lobby (group) ───────────────────────────
function emptySeat(hostId: number, hostName: string | undefined, seat: number): ScalaPlayer {
  return {
    id: seat === 0 ? hostId : null,
    name: seat === 0 ? hostName || 'میزبان' : `بازیکن ${faNum(seat + 1)}`,
    hand: [],
    isBot: false,
    score: 0,
    retired: false,
    hasOpened: false,
    dmMessageId: null,
    dmSignature: null,
  };
}

function lobbyPlayers(session: ScalaSession): ScalaPlayer[] {
  const hostName =
    session.players.find((p) => p.id === session.hostId)?.name ?? session.hostName;
  const seats: ScalaPlayer[] = [];
  for (let seat = 0; seat < session.seatCount; seat++) {
    seats.push(emptySeat(session.hostId, hostName, seat));
  }
  return seats;
}

function buildLobbyText(session: ScalaSession): string {
  const lines: string[] = [];
  lines.push('🇮🇹 *بازی اسکالا (Scala 40)*');
  lines.push('');
  lines.push('🂠 *دو دست کارت + ۴ جایکر (۱۰۸ کارت)* — به هر بازیکن *۱۳ کارت*');
  lines.push('🎯 *برندهٔ هر دست* کسی است که زودتر همهٔ کارت‌هایش را بگذارد و کارت آخر را دور بریزد (بستن بازی).');
  lines.push(`📌 برای *باز شدن* باید یک‌جا مخل‌هایی با مجموع ${faNum(OPEN_POINTS)} امتیاز روی میز بگذارید.`);
  lines.push(`🏁 هر کس امتیاز کیفری‌اش به ${faNum(TARGET_POINTS)} برسد، از مسابقه *خارج* می‌شود.`);
  lines.push('');
  lines.push('🃏 *سری (اسکالا):* سه کارت پشت‌سرهم و هم‌خال — مثل ♠️۵ ♠️۶ ♠️۷');
  lines.push('🎴 *ست (کمبینازیونه):* سه یا چهار کارت هم‌رتبه با خال‌های متفاوت');
  lines.push('🃏 در هر مخل فقط *یک جایکر*؛ ارزشش به اندازهٔ کارتی است که جایش نشسته');
  lines.push('🔢 ارزش در دست: ۲ تا ۱۰ = رویشان | B/Q/K = ۱۰ | اَس = ۱۱ | جایکر = ۲۵');
  lines.push('');
  lines.push('👥 *حالت بازی:* ' + (session.mode === 'single' ? 'تک‌دست (یک دست، بسته = برنده)' : `مسابقه تا ${faNum(TARGET_POINTS)}`));
  lines.push('🪑 *صندلی‌ها:* ' + faNum(session.seatCount));
  lines.push('');
  lines.push('📋 *بازیکنان:*');
  for (let seat = 0; seat < session.seatCount; seat++) {
    const p = session.players[seat];
    if (p.id) lines.push(`${faNum(seat + 1)}. ${playerName(p)}`);
    else lines.push(`${faNum(seat + 1)}. ⬜ — خالی —`);
  }
  lines.push('');
  lines.push('🔒 وقتی بازی شروع شود، کارت‌های شما *فقط در گفتگوی خصوصی* با ربات فرستاده می‌شود؛');
  lines.push('هیچ بازیکنی دست بقیه را نمی‌بیند و پیامی از بازی در گروه نمی‌ماند.');
  return lines.join('\n');
}

async function botDmRow(ctx: Context): Promise<any[] | undefined> {
  try {
    const me = await ctx.telegram.getMe();
    if (!me?.username) return undefined;
    return [Markup.button.url('🤖 گفتگوی خصوصی با ربات', `https://t.me/${me.username}`)];
  } catch {
    return undefined;
  }
}

async function buildLobbyKeyboard(ctx: Context, session: ScalaSession): Promise<any> {
  const rows: any[][] = [];

  if (humanCount(session) >= session.seatCount) {
    rows.push([Markup.button.callback('♟️ میز کامل است', 'scala_wait')]);
  } else {
    rows.push([Markup.button.callback('🎮 نشستن روی صندلی', 'scala_join')]);
    rows.push([Markup.button.callback('🚪 خروج از بازی', 'scala_leave')]);
  }

  const seatButtons: any[] = [];
  for (let n = MIN_SEATS; n <= MAX_SEATS; n++) {
    seatButtons.push(
      Markup.button.callback(
        (session.seatCount === n ? '▪️ ' : '') + `${faNum(n)} نفره`,
        `scala_seats_${n}`
      )
    );
  }
  rows.push(seatButtons);

  rows.push([
    Markup.button.callback(
      (session.mode === 'single' ? '▪️ ' : '') + '🎯 تک‌دست',
      'scala_mode_single'
    ),
    Markup.button.callback(
      (session.mode === 'match' ? '▪️ ' : '') + `🏁 مسابقه تا ${faNum(TARGET_POINTS)}`,
      'scala_mode_match'
    ),
  ]);

  const dmRow = await botDmRow(ctx);
  if (dmRow) rows.push(dmRow);

  rows.push([Markup.button.callback('▶️ شروع بازی', 'scala_start')]);
  rows.push([Markup.button.callback('❌ لغو', 'scala_cancel')]);
  return Markup.inlineKeyboard(rows);
}

/** دکمه‌های پیام کوتاه نتیجه در گروه */
function buildResultKeyboard(): any {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔄 بازی جدید در گروه', 'scala_new')],
    [Markup.button.callback('🎮 منوی بازی', 'games')],
  ]);
}

// ─── Private hand (DM) ───────────────────────
function meldLine(meld: Meld, index: number, players: ScalaPlayer[]): string {
  const labels = meld.cards.map((c) => cardLabel(c)).join(' ');
  const owner = players[meld.ownerSeat] ? playerName(players[meld.ownerSeat], false) : '—';
  const kind = meld.kind === 'scala' ? 'سری' : 'ست';
  return `${faNum(index + 1)}. ${kind} ${labels} (${faNum(meld.points)}) — ${owner}`;
}

function tableBlock(session: ScalaSession): string[] {
  if (session.table.length === 0) return ['🈳 میز هنوز خالی است.'];
  const lines = ['🪧 *مخل‌های روی میز (بین همه مشترک):*'];
  const show = session.table.slice(-12);
  const offset = session.table.length - show.length;
  if (offset > 0) lines.push(`… ${faNum(offset)} مخل قبلی روی میز است`);
  show.forEach((meld, i) => lines.push(meldLine(meld, i + offset, session.players)));
  return lines;
}

function scoreBlock(session: ScalaSession): string[] {
  const lines = ['📊 *امتیاز کیفری:*'];
  for (let seat = 0; seat < session.players.length; seat++) {
    const p = session.players[seat];
    const marks: string[] = [];
    if (p.retired) marks.push('❌ خارج');
    else if (p.hasOpened || p.id === null) marks.push(p.hasOpened ? '🟢 باز' : '⚪ باز نشده');
    const me = seat === session.turn && session.status === 'playing' ? ' ⬅️ نوبت' : '';
    lines.push(
      `• ${faNum(seat + 1)} ${playerName(p, false)} — ${faNum(p.score)}${marks.length ? ' (' + marks.join('، ') + ')' : ''}${me}`
    );
  }
  return lines;
}

/**
 * افشای پایان دست: کارت‌هایی که در دست بازیکنان مانده است.
 * در اسکالا واقعی، کیفرِ هر بازیکن از همین کارت‌ها شمرده می‌شود، پس در پایان
 * دست (و فقط در پیویِ بازیکنان) رو می‌شوند — هرگز در گروه.
 */
function revealedHands(session: ScalaSession): string[] {
  const lines = ['🂠 *کارت‌های باقی‌ماندهٔ بازیکنان:*'];
  for (let s = 0; s < session.players.length; s++) {
    const p = session.players[s];
    const closed = session.closedBy === s ? ' 🎯 بست' : '';
    const labels = p.hand.length ? handLabels(sortHand(p.hand)).join(' ') : '—';
    lines.push(`• ${faNum(s + 1)} ${playerName(p, false)}${closed} — ${labels}`);
  }
  return lines;
}

function buildScalaPrivateText(session: ScalaSession, seat: number): string {
  const player = session.players[seat];
  const lines: string[] = [];
  lines.push('🇮🇹 *اسکالا — دست خصوصی شما*');
  lines.push('');
  lines.push('🔒 این پیام فقط برای شماست. بازیکنان دیگر دست شما را نمی‌بینند.');
  lines.push('');

  if (session.notices.length) {
    for (const notice of session.notices) lines.push(notice);
    lines.push('');
  }

  if (session.status === 'handover') {
    const result = session.lastHand;
    lines.push(`🏁 *دست ${faNum(session.handNumber)} تمام شد*`);
    if (result) {
      if (result.seat === null) lines.push('🤝 مخزن تمام شد و کسی بازی را نبست — امتیاز کیفریِ دست‌ها نوشته شد.');
      else lines.push(`🎯 ${playerName(session.players[result.seat], false)} بازی را بست (بدون امتیاز کیفری).`);
      lines.push('');
      for (let s = 0; s < session.players.length; s++) {
        lines.push(`• ${faNum(s + 1)} ${playerName(session.players[s], false)} — ${faNum(session.players[s].score)}`);
      }
    }
    lines.push('');
    lines.push(...revealedHands(session));
    lines.push('');
    if (player.retired) lines.push('😔 شما از مسابقه خارج شدید؛ برای بازی جدید در گروه منتظر بمانید.');
    else if (session.hostId === player.id) lines.push('▶️ با دکمهٔ پایین، دست بعدی شروع می‌شود.');
    else lines.push('⏳ میزبان باید دست بعدی را شروع کند.');
    return lines.join('\n');
  }

  if (session.status === 'finished') {
    const winner = session.winner !== null ? session.players[session.winner] : null;
    lines.push(winner ? `🏆 *برندهٔ مسابقه:* ${playerName(winner, false)}` : '🤝 *این مسابقه برنده‌ای نداشت.*');
    lines.push('');
    for (let s = 0; s < session.players.length; s++) {
      const p = session.players[s];
      const tag = p.retired ? ' ❌ خارج شده' : '';
      lines.push(`• ${faNum(s + 1)} ${playerName(p, false)} — ${faNum(p.score)}${tag}`);
    }
    lines.push('');
    lines.push(...revealedHands(session));
    lines.push('');
    lines.push(`⭐️ ${faNum(POINTS_MATCH_WIN)} امتیاز برای برنده`);
    lines.push('📝 نتیجه در گروه اعلام شد و پیام‌های بازی کمی بعد پاک می‌شوند.');
    return lines.join('\n');
  }

  const isActor = session.turn === seat && !player.isBot;
  lines.push(`🎴 *دست شما (${faNum(player.hand.length)} کارت):*`);
  const labels = handLabels(sortHand(player.hand));
  lines.push(labels.length ? labels.join(' ') : '—');
  lines.push('');
  if (session.selected.length && isActor) {
    const chosen = session.selected
      .map((id) => player.hand.find((c) => c.id === id))
      .filter((c): c is Card => !!c);
    lines.push(`👈 *انتخاب شما:* ${chosen.map((c) => cardLabel(c)).join(' ') || '—'}`);
    lines.push('');
  }
  lines.push(...tableBlock(session));
  lines.push('');
  lines.push(...scoreBlock(session));
  lines.push('');
  lines.push(
    `🂠 *مخزن:* ${faNum(session.stock.length)} کارت — 🗑️ *مخلفات:* ${faNum(session.discard.length)}` +
      (session.discard.length ? ` | رو: ${cardLabel(session.discard[session.discard.length - 1])}` : '')
  );
  lines.push(`🎲 *دست ${faNum(session.handNumber)} — نوبت ${faNum(session.turnNumber)}*`);
  lines.push('');

  if (!isActor) {
    const name = playerName(session.players[session.turn], false);
    lines.push(`⏳ نوبتِ ${session.players[session.turn].isBot ? 'ربات' : name} است — منتظر بمانید.`);
    return lines.join('\n');
  }

  if (session.phase === 'draw') {
    lines.push('👇 *نوبت شما:* یک کارت بردارید (از مخزن یا از روِ مخلفات).');
    lines.push('_کارتِ مخلفات را فقط می‌توان برد که همین نوبت با آن مخل بگذارید._');
  } else if (session.phase === 'meld') {
    if (!player.hasOpened) {
      lines.push(
        `🎯 *هنوز باز نشده‌اید* — مخل‌های این نوبت باید مجموعاً ${faNum(OPEN_POINTS)} امتیاز شوند ` +
          `(تا الان ${faNum(session.turnMeldPoints)}).`
      );
    } else {
      lines.push('🃏 کارت‌های مخل را انتخاب کنید و «ثبت مخل» یا «افزودن به میز» را بزنید.');
    }
    lines.push('_برای بستن بازی باید همهٔ کارت‌ها را بگذارید و یک کارت آخر بماند تا دور بریزید._');
  } else {
    lines.push('🗑️ *یک کارت دور بریزید* تا نوبت به نفر بعد برسد.');
    if (player.hand.length === 1) lines.push('🎯 یک کارت مانده — با «بستن بازی» دست را تمام کنید!');
  }

  return lines.join('\n');
}

function buildScalaPrivateKeyboard(session: ScalaSession, seat: number): any {
  const rows: any[][] = [];
  const player = session.players[seat];
  const isActor = session.turn === seat && !player.isBot && session.status === 'playing';

  if (session.status === 'handover') {
    if (session.hostId === player.id) rows.push([Markup.button.callback('▶️ دست بعدی', 'scala_next_hand')]);
    rows.push([Markup.button.callback('🔄 به‌روزرسانی', 'scala_resend')]);
    return Markup.inlineKeyboard(rows);
  }

  if (session.status === 'finished') {
    if (session.hostId === player.id) {
      rows.push([Markup.button.callback('🔄 بازی جدید در گروه', 'scala_new')]);
    }
    rows.push([Markup.button.callback('📊 دیدن دوبارهٔ دست آخر', 'scala_resend')]);
    return Markup.inlineKeyboard(rows);
  }

  if (isActor && session.phase === 'draw') {
    rows.push([Markup.button.callback(`🂠 بردن از مخزن (${faNum(session.stock.length)})`, 'scala_draw_stock')]);
    if (session.discard.length > 0) {
      const top = session.discard[session.discard.length - 1];
      rows.push([
        Markup.button.callback(`🫳 بردن ${cardLabel(top)} از مخلفات`, 'scala_draw_discard'),
      ]);
    }
  }

  if (isActor && session.phase === 'meld') {
    const cards = sortHand(player.hand);
    const buttons = cards.map((card) =>
      Markup.button.callback(
        (session.selected.includes(card.id) ? '▪️' : '') + cardLabel(card),
        `scala_sel_${card.id}`
      )
    );
    for (let i = 0; i < buttons.length; i += 5) rows.push(buttons.slice(i, i + 5));
    rows.push([
      Markup.button.callback('✅ ثبت مخل', 'scala_meld'),
      Markup.button.callback('➕ افزودن به میز', 'scala_layoff'),
    ]);
    rows.push([Markup.button.callback('🧹 پاک کردن انتخاب', 'scala_clear')]);
    rows.push([Markup.button.callback('⏭️ رفتن به دورریز', 'scala_to_discard')]);
  }

  if (isActor && session.phase === 'discard') {
    if (canClose(session)) {
      rows.push([Markup.button.callback('🎯 بستن بازی!', 'scala_close')]);
    }
    const cards = sortHand(player.hand).filter((card) =>
      isDiscardAllowed(card, {
        hasOpened: player.hasOpened,
        takenFromDiscard: session.takenFromDiscard,
        owedJoker: session.owedJoker,
      }).ok
    );
    const buttons = cards.map((card) => Markup.button.callback(cardLabel(card), `scala_disc_${card.id}`));
    for (let i = 0; i < buttons.length; i += 5) rows.push(buttons.slice(i, i + 5));
  }

  // میزبان می‌تواند نوبتِ بازیکنی که جواب نمی‌دهد را رد کند تا میز قفل نماند
  if (
    session.status === 'playing' &&
    session.hostId === player.id &&
    !player.isBot &&
    session.turn !== seat &&
    !session.players[session.turn].isBot
  ) {
    rows.push([
      Markup.button.callback(
        `⏭️ واگذاری نوبتِ ${playerName(session.players[session.turn], false).replace(/[[\]]/g, '')}`,
        'scala_pass'
      ),
    ]);
  }

  rows.push([Markup.button.callback('🔄 به‌روزرسانی دست', 'scala_resend')]);
  if (session.hostId === player.id) {
    rows.push([Markup.button.callback('❌ لغو بازی', 'scala_cancel')]);
  }
  return Markup.inlineKeyboard(rows);
}

// ─── Start ───────────────────────────────────
export async function handleScala(ctx: Context) {
  if (!(await requireGroup(ctx, 'اسکالا'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);
  const existing = sessions.get(key);

  if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < 1800000) {
    await sendGameMessage(
      ctx,
      key,
      existing.status === 'waiting'
        ? '⏳ یک بازی اسکالا در این گروه در حال تشکیل است؛ روی همان پیام صندلی بگیرید.'
        : '⏳ یک بازی اسکالا در این گروه در جریان است؛ بازی در *گفتگوی خصوصی* بازیکنان ادامه دارد.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const from = ctx.from!;
  const session: ScalaSession = {
    chatId,
    messageId: 0,
    hostId: from.id,
    hostName: from.first_name || from.username || 'میزبان',
    seatCount: MAX_SEATS,
    mode: 'match',
    status: 'waiting',
    players: [],
    table: [],
    stock: [],
    discard: [],
    turn: 0,
    phase: 'draw',
    selected: [],
    takenFromDiscard: null,
    owedJoker: null,
    jokerWarned: false,
    turnMeldPoints: 0,
    turnMelds: [],
    handNumber: 0,
    turnNumber: 0,
    firstTurnSeat: 0,
    closedBy: null,
    lastHand: null,
    winner: null,
    notices: [],
    busy: false,
    boardSignature: null,
    boardCleared: false,
    createdAt: Date.now(),
  };
  session.players = lobbyPlayers(session);
  sessions.set(key, session);

  const messageId = await sendGameMessage(ctx, key, buildLobbyText(session), {
    parse_mode: 'Markdown',
    ...(await buildLobbyKeyboard(ctx, session)),
  });
  if (typeof messageId === 'number') session.messageId = messageId;
}

// ─── Action handler ──────────────────────────
export async function handleScalaAction(ctx: Context) {
  const action = (ctx.callbackQuery as any).data as string;
  const userId = ctx.from!.id;

  let session = sessions.get(sessionKey(ctx.chat!.id));
  if (!session) session = findSessionByUser(userId);
  if (!session) {
    await ctx.answerCbQuery('⏰ بازی منقضی شده یا وجود ندارد.');
    return;
  }

  // ── صبر ──
  if (action === 'scala_wait') {
    await ctx.answerCbQuery('⏳ لطفاً صبر کنید...');
    return;
  }

  // ── لغو ──
  if (action === 'scala_cancel') {
    if (userId !== session.hostId) {
      await ctx.answerCbQuery('❌ فقط میزبان می‌تواند بازی را لغو کند.');
      return;
    }
    sessions.delete(sessionKey(session.chatId));
    await ctx.answerCbQuery('بازی لغو شد.');
    await cancelScala(ctx, session);
    return;
  }

  // ── بازی جدید ──
  if (action === 'scala_new') {
    if (userId !== session.hostId) {
      await ctx.answerCbQuery('❌ فقط میزبان می‌تواند بازی جدید بسازد.');
      return;
    }
    const key = sessionKey(session.chatId);
    resetScalaSession(session);
    const messageId = await postGameMessage(ctx.telegram, key, session.chatId, buildLobbyText(session), {
      parse_mode: 'Markdown',
      ...(await buildLobbyKeyboard(ctx, session)),
    });
    if (typeof messageId === 'number') {
      session.messageId = messageId;
      session.boardCleared = false;
    } else {
      session.boardCleared = false;
      session.boardSignature = null;
      await editGroupBoard(ctx, session);
    }
    await ctx.answerCbQuery('🔄 لابیٔ تازه در گروه باز شد!');
    return;
  }

  // ── تنظیمات لابی ──
  if (action.startsWith('scala_seats_')) {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی شروع شده!');
      return;
    }
    if (userId !== session.hostId) {
      await ctx.answerCbQuery('❌ فقط میزبان تعداد صندلی را تغییر می‌دهد.');
      return;
    }
    const n = parseInt(action.replace('scala_seats_', ''), 10);
    if (n < MIN_SEATS || n > MAX_SEATS) {
      await ctx.answerCbQuery('❌ تعداد صندلی نامعتبر است.');
      return;
    }
    // صندلی را کم و زیاد می‌کنیم؛ بازیکنانی که سرِ میز هستند حذف نمی‌شوند،
    // مگر اینکه صندلی‌شان از انتهای میز بیرون بیفتد (آن‌گاه اعلام می‌شود).
    const hostName =
      session.players.find((p) => p.id === session.hostId)?.name ?? session.hostName;
    const dropped = session.players
      .slice(n)
      .filter((p) => !p.isBot && p.id !== null && p.id !== session.hostId);
    const seats = session.players.slice(0, n);
    while (seats.length < n) seats.push(emptySeat(session.hostId, hostName, seats.length));
    session.players = seats;
    session.seatCount = n;
    await ctx.answerCbQuery(
      dropped.length
        ? `🪑 میز ${faNum(n)} نفره شد؛ ${dropped.map((p) => p.name).join('، ')} از میز افتاد.`
        : `🪑 میز ${faNum(n)} نفره شد.`
    );
    await syncAll(ctx, session);
    return;
  }

  if (action === 'scala_mode_single' || action === 'scala_mode_match') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی شروع شده!');
      return;
    }
    if (userId !== session.hostId) {
      await ctx.answerCbQuery('❌ فقط میزبان حالت بازی را تغییر می‌دهد.');
      return;
    }
    session.mode = action === 'scala_mode_single' ? 'single' : 'match';
    await ctx.answerCbQuery(
      session.mode === 'single' ? '🎯 حالت تک‌دست انتخاب شد.' : `🏁 مسابقه تا ${faNum(TARGET_POINTS)} امتیاز.`
    );
    await syncAll(ctx, session);
    return;
  }

  // ── نشستن / خروج ──
  if (action === 'scala_join') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (seatOf(session, userId) >= 0) {
      await ctx.answerCbQuery('شما قبلاً روی صندلی نشسته‌اید!');
      return;
    }
    if (humanCount(session) >= session.seatCount) {
      await ctx.answerCbQuery('❌ میز کامل است.');
      return;
    }
    if (!(await verifyPrivateChannel(ctx, userId))) {
      await ctx.answerCbQuery(
        '❌ اول در گفتگوی خصوصی با ربات گفتگو کنید (دکمهٔ «🤖 گفتگوی خصوصی با ربات» روی همین پیام).',
        { show_alert: true }
      );
      return;
    }
    const freeSeat = session.players.findIndex((p) => p.id === null && !p.isBot);
    if (freeSeat < 0) {
      await ctx.answerCbQuery('❌ میز کامل است.');
      return;
    }
    session.players[freeSeat] = {
      id: userId,
      name: ctx.from!.first_name || 'بازیکن',
      hand: [],
      isBot: false,
      score: 0,
      retired: false,
      hasOpened: false,
      dmMessageId: null,
      dmSignature: null,
    };
    await ctx.answerCbQuery('🎮 روی صندلی نشستید!');
    await syncAll(ctx, session);
    return;
  }

  if (action === 'scala_leave') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی شروع شده و نمی‌توانید خارج شوید.');
      return;
    }
    const seat = seatOf(session, userId);
    if (seat < 0) {
      await ctx.answerCbQuery('شما در این بازی نیستید.');
      return;
    }
    if (seat === 0) {
      await ctx.answerCbQuery('❌ میزبان نمی‌تواند از بازی خارج شود.');
      return;
    }
    session.players[seat] = emptySeat(session.hostId, undefined, seat);
    await ctx.answerCbQuery('🚪 از بازی خارج شدید.');
    await syncAll(ctx, session);
    return;
  }

  // ── شروع بازی ──
  if (action === 'scala_start') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (userId !== session.hostId) {
      await ctx.answerCbQuery('❌ فقط میزبان می‌تواند بازی را شروع کند.');
      return;
    }
    seatPlayers(session);
    session.notices = [];
    session.status = 'playing';
    session.handNumber = 1;

    const ok = await dealAndSendHands(ctx, session);
    if (!ok) {
      session.status = 'waiting';
      await ctx.answerCbQuery('❌ هیچ بازیکن واقعی در میز نماند؛ بازی شروع نشد.', { show_alert: true });
      await syncAll(ctx, session);
      return;
    }

    await clearGroupBoard(ctx, session);
    await ctx.answerCbQuery('🎴 کارت‌ها پخش شد! بازی در گفتگوی خصوصی ادامه دارد.');
    await syncAll(ctx, session);
    await driveBots(ctx, session);
    return;
  }

  // ── دست بعدی (حالت مسابقه) ──
  if (action === 'scala_next_hand') {
    if (session.status !== 'handover') {
      await ctx.answerCbQuery('الان وقت دست جدید نیست.');
      return;
    }
    if (userId !== session.hostId) {
      await ctx.answerCbQuery('❌ فقط میزبان دست بعدی را شروع می‌کند.');
      return;
    }
    session.notices = [];
    session.status = 'playing';
    session.handNumber++;
    await startHand(session);
    for (let seat = 0; seat < session.players.length; seat++) {
      const p = session.players[seat];
      if (p.isBot || !p.id) continue;
      p.dmSignature = null;
      await sendPrivateHand(ctx, session, seat);
    }
    await ctx.answerCbQuery(`▶️ دست ${faNum(session.handNumber)} شروع شد.`);
    await driveBots(ctx, session);
    return;
  }

  // ── به‌روزرسانی دست ──
  if (action === 'scala_resend') {
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
    session.players[seat].dmSignature = null;
    await sendPrivateHand(ctx, session, seat);
    return;
  }

  // ── واگذاری نوبتِ بازیکن ساکت (میزبان) ──
  if (action === 'scala_pass') {
    if (userId !== session.hostId) {
      await ctx.answerCbQuery('❌ فقط میزبان می‌تواند نوبت را رد کند.');
      return;
    }
    if (session.status !== 'playing') {
      await ctx.answerCbQuery('بازی در جریان نیست.');
      return;
    }
    const target = session.players[session.turn];
    if (target.isBot || !target.id) {
      await ctx.answerCbQuery('نوبت بازیکن واقعی نیست.');
      return;
    }
    await ctx.answerCbQuery(`⏭️ نوبت ${target.name} با ربات بازی شد.`);
    await autoPlaySeat(ctx, session, session.turn);
    await afterTurn(ctx, session);
    return;
  }

  const isActorTurn =
    session.status === 'playing' &&
    session.turn === seatOf(session, userId) &&
    !actor(session).isBot;

  // ── بردن کارت ──
  if (action === 'scala_draw_stock' || action === 'scala_draw_discard') {
    if (!isActorTurn) {
      await ctx.answerCbQuery('⏳ نوبت شما نیست!');
      return;
    }
    if (session.phase !== 'draw') {
      await ctx.answerCbQuery('این نوبت کارت برداشته شده است.');
      return;
    }
    const player = actor(session);

    if (action === 'scala_draw_stock') {
      if (!refillStock(session)) {
        await exhaustStock(ctx, session);
        return;
      }
      const card = session.stock.shift() as Card;
      player.hand.push(card);
      session.takenFromDiscard = null;
    } else {
      if (session.discard.length === 0) {
        await ctx.answerCbQuery('❌ مخلفات خالی است.');
        return;
      }
      const card = session.discard[session.discard.length - 1];
      session.discard.pop();
      player.hand.push(card);
      session.takenFromDiscard = card;
    }

    session.phase = 'meld';
    session.selected = [];
    await ctx.answerCbQuery('🎴 کارت برداشته شد.');
    await syncAll(ctx, session);
    return;
  }

  // ── انتخاب کارت ──
  if (action.startsWith('scala_sel_')) {
    if (!isActorTurn) {
      await ctx.answerCbQuery('⏳ نوبت شما نیست!');
      return;
    }
    if (session.phase !== 'meld') {
      await ctx.answerCbQuery('⏳ اول باید کارت بردارید.');
      return;
    }
    const id = parseInt(action.replace('scala_sel_', ''), 10);
    const card = actor(session).hand.find((c) => c.id === id);
    if (!card) {
      await ctx.answerCbQuery('❌ این کارت در دست شما نیست.');
      return;
    }
    const at = session.selected.indexOf(id);
    if (at >= 0) session.selected.splice(at, 1);
    else session.selected.push(id);
    await ctx.answerCbQuery();
    await syncAll(ctx, session);
    return;
  }

  if (action === 'scala_clear') {
    if (!isActorTurn) {
      await ctx.answerCbQuery('⏳ نوبت شما نیست!');
      return;
    }
    session.selected = [];
    await ctx.answerCbQuery('🧹 انتخاب پاک شد.');
    await syncAll(ctx, session);
    return;
  }

  // ── ثبت مخل جدید ──
  if (action === 'scala_meld') {
    if (!isActorTurn) {
      await ctx.answerCbQuery('⏳ نوبت شما نیست!');
      return;
    }
    if (session.phase !== 'meld') {
      await ctx.answerCbQuery('⏳ اول باید کارت بردارید.');
      return;
    }
    const player = actor(session);
    const cards = session.selected
      .map((id) => player.hand.find((c) => c.id === id))
      .filter((c): c is Card => !!c);

    if (cards.length < 3) {
      await ctx.answerCbQuery('❌ برای مخل دست‌کم سه کارت انتخاب کنید.', { show_alert: true });
      return;
    }
    if (player.hand.length - cards.length < 1) {
      await ctx.answerCbQuery(
        '❌ یک کارت باید برای دور ریختن بماند؛ کل دست را نمی‌توانید بگذارید.',
        { show_alert: true }
      );
      return;
    }
    const check = resolveMeld(cards, session.turn);
    if (!check.ok) {
      await ctx.answerCbQuery(`❌ ${check.error}`, { show_alert: true });
      return;
    }
    // اگر بازیکن باز نشده باشد، مخل‌ها تا رسیدن به ۴۰ امتیاز موقت‌اند؛
    // در پایان نوبت، اگر مجموع به ۴۰ نرسد همه پس گرفته می‌شود (پایین‌تر).
    if (
      session.takenFromDiscard &&
      session.turnMelds.length === 0 &&
      !cards.some((c) => c.id === session.takenFromDiscard!.id)
    ) {
      await ctx.answerCbQuery(
        '❌ کارتی را که از مخلفات برداشته‌اید باید در اولین مخل همین نوبت بگذارید.',
        { show_alert: true }
      );
      return;
    }

    const ids = new Set(cards.map((c) => c.id));
    player.hand = player.hand.filter((c) => !ids.has(c.id));
    session.table.push(check.meld);
    session.turnMelds.push(check.meld);
    session.turnMeldPoints += check.meld.points;
    if (!player.hasOpened && session.turnMeldPoints >= OPEN_POINTS) {
      player.hasOpened = true;
      session.notices = [`🟢 ${playerName(player, false)} باز شد (${faNum(session.turnMeldPoints)} امتیاز مخل)!`];
    }
    // اگر جایکرِ پس‌گرفته‌شده در این مخل مصرف شد، دیگر بدهی نیست
    if (session.owedJoker && cards.some((c) => c.id === session.owedJoker!.id)) {
      session.owedJoker = null;
    }
    session.selected = [];
    await ctx.answerCbQuery(`✅ مخل ${faNum(check.meld.points)} امتیازی روی میز رفت.`);
    await syncAll(ctx, session);
    return;
  }

  // ── افزودن به میز (لای‌آف) ──
  if (action === 'scala_layoff') {
    if (!isActorTurn) {
      await ctx.answerCbQuery('⏳ نوبت شما نیست!');
      return;
    }
    if (session.phase !== 'meld') {
      await ctx.answerCbQuery('⏳ اول باید کارت بردارید.');
      return;
    }
    const player = actor(session);
    if (!player.hasOpened) {
      await ctx.answerCbQuery('❌ تا باز نشوید نمی‌توانید به مخل‌های دیگران کارت اضافه کنید.', {
        show_alert: true,
      });
      return;
    }
    const cards = session.selected
      .map((id) => player.hand.find((c) => c.id === id))
      .filter((c): c is Card => !!c);
    if (cards.length === 0) {
      await ctx.answerCbQuery('❌ اول کارت‌های موردنظر را انتخاب کنید.');
      return;
    }
    let added = 0;
    let jokerTaken: Card | null = null;
    for (const card of cards) {
      const index = session.table.findIndex((meld) => canLayOff(meld, card).ok);
      if (index < 0) {
        await ctx.answerCbQuery(`❌ ${cardLabel(card)} روی هیچ مخلِ میز نمی‌نشیند.`, { show_alert: true });
        return;
      }
      const res = canLayOff(session.table[index], card);
      if (res.takesJoker) {
        if (session.owedJoker || jokerTaken) {
          await ctx.answerCbQuery('❌ در یک نوبت فقط می‌توان یک جایکر پس گرفت.', { show_alert: true });
          return;
        }
        jokerTaken = res.takesJoker;
      }
      session.table[index] = applyLayOff(session.table[index], card);
      player.hand = player.hand.filter((c) => c.id !== card.id);
      added++;
    }
    if (jokerTaken) {
      player.hand.push(jokerTaken);
      session.owedJoker = jokerTaken;
      session.jokerWarned = false;
      session.notices = [
        `♻️ جایکر را پس گرفتید! باید همین نوبت آن را در مخلی بگذارید یا در پایان دور بریزید.`,
      ];
    }
    session.selected = [];
    await ctx.answerCbQuery(`➕ ${faNum(added)} کارت به میز اضافه شد.`);
    await syncAll(ctx, session);
    return;
  }

  // ── رفتن به مرحلهٔ دورریز ──
  if (action === 'scala_to_discard') {
    if (!isActorTurn) {
      await ctx.answerCbQuery('⏳ نوبت شما نیست!');
      return;
    }
    if (session.phase !== 'meld') {
      await ctx.answerCbQuery('شما در مرحلهٔ دورریز هستید.');
      return;
    }

    // کارتِ مخلفات که مخل نشد، سرِ مخلفات برمی‌گردد
    if (session.takenFromDiscard) {
      const player = actor(session);
      const kept = player.hand.find((c) => c.id === session.takenFromDiscard!.id);
      if (kept) {
        player.hand = player.hand.filter((c) => c.id !== kept.id);
        session.discard.push(kept);
        session.notices = ['↩️ کارتِ مخلفات را مخل نکردید؛ به مخلفات برگشت.'];
      }
      session.takenFromDiscard = null;
    }

    // اگر باز نشده، مخل‌های این نوبت پس گرفته می‌شوند
    const player = actor(session);
    if (!player.hasOpened && session.turnMeldPoints < OPEN_POINTS && session.turnMelds.length) {
      const back = session.turnMelds;
      session.table = session.table.filter((meld) => !back.includes(meld));
      for (const meld of back) player.hand.push(...meld.cards);
      session.turnMelds = [];
      session.turnMeldPoints = 0;
      await ctx.answerCbQuery(
        `↩️ مجموع مخل‌ها به ${faNum(OPEN_POINTS)} امتیاز نرسید؛ همه پس گرفته شد.`,
        { show_alert: true }
      );
    }

    // جایکرِ پس‌گرفته‌شده که مصرف نشده
    if (session.owedJoker) {
      const stillHeld = player.hand.some((c) => c.id === session.owedJoker!.id);
      if (stillHeld && !session.jokerWarned) {
        session.jokerWarned = true;
        await ctx.answerCbQuery('⚠️ جایکر را در همین نوبت مخل کنید؛ اگر نشد، دوباره بزنید تا دور ریخته شود.', {
          show_alert: true,
        });
        return;
      }
    }

    session.phase = 'discard';
    session.selected = [];
    await ctx.answerCbQuery('🗑️ حالا یک کارت دور بریزید.');
    await syncAll(ctx, session);
    return;
  }

  // ── دور ریختن ──
  if (action.startsWith('scala_disc_')) {
    if (!isActorTurn) {
      await ctx.answerCbQuery('⏳ نوبت شما نیست!');
      return;
    }
    if (session.phase !== 'discard') {
      await ctx.answerCbQuery('⏳ اول کارت بردارید و مخل‌هایتان را بگذارید.');
      return;
    }
    const id = parseInt(action.replace('scala_disc_', ''), 10);
    const player = actor(session);
    const card = player.hand.find((c) => c.id === id);
    if (!card) {
      await ctx.answerCbQuery('❌ این کارت در دست شما نیست.');
      return;
    }
    const allow = isDiscardAllowed(card, {
      hasOpened: player.hasOpened,
      takenFromDiscard: session.takenFromDiscard,
      owedJoker: session.owedJoker,
    });
    if (!allow.ok) {
      await ctx.answerCbQuery(`❌ ${allow.reason}`, { show_alert: true });
      return;
    }
    player.hand = player.hand.filter((c) => c.id !== id);
    session.discard.push(card);
    if (session.owedJoker && card.id === session.owedJoker.id) session.owedJoker = null;
    await ctx.answerCbQuery(`🗑️ ${cardLabel(card)} دور ریخته شد.`);
    await afterTurn(ctx, session);
    return;
  }

  // ── بستن بازی ──
  if (action === 'scala_close') {
    if (!isActorTurn) {
      await ctx.answerCbQuery('⏳ نوبت شما نیست!');
      return;
    }
    if (session.phase !== 'discard') {
      await ctx.answerCbQuery('⏳ کارت باید در مرحلهٔ دورریز باشد.');
      return;
    }
    if (!canClose(session)) {
      await ctx.answerCbQuery('❌ هنوز شرایط بستن فراهم نیست.', { show_alert: true });
      return;
    }
    const seat = session.turn;
    const last = actor(session).hand[0];
    actor(session).hand = [];
    session.discard.push(last);
    await ctx.answerCbQuery('🎯 بازی بسته شد!');
    await finishHand(ctx, session, seat);
    return;
  }
}

// ─── Private channel helpers ─────────────────
async function verifyPrivateChannel(ctx: Context, userId: number): Promise<boolean> {
  try {
    await ctx.telegram.sendMessage(
      userId.toString(),
      '🇮🇹 *بازی اسکالا*\n\n' +
        '🔒 کارت‌های شما فقط در همین گفتگوی خصوصی ارسال می‌شود؛ هیچ بازیکن دیگری دست شما را نمی‌بیند.'
    );
    return true;
  } catch {
    return false;
  }
}

async function sendPrivateHand(ctx: Context, session: ScalaSession, seat: number): Promise<boolean> {
  const player = session.players[seat];
  if (!player.id) return false;

  const text = buildScalaPrivateText(session, seat);
  const extra = { parse_mode: 'Markdown', ...buildScalaPrivateKeyboard(session, seat) };
  const signature = text + JSON.stringify(extra.reply_markup);
  if (player.dmSignature === signature) return true;

  try {
    if (player.dmMessageId) {
      await ctx.telegram.editMessageText(player.id.toString(), player.dmMessageId, undefined, text, extra);
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

// ─── Deal & turn engine ──────────────────────
/** صندلی‌ها: میزبان ثابت، بقیه تصادفی، خالی‌ها با ربات */
function seatPlayers(session: ScalaSession): void {
  const host = session.players.find((p) => p.id === session.hostId) ?? session.players[0];
  const others = session.players.filter((p) => !p.isBot && p.id !== null && p.id !== session.hostId);
  const slots = shuffleArray([...Array(session.seatCount).keys()].filter((i) => i !== 0));

  const seated: (ScalaPlayer | null)[] = new Array(session.seatCount).fill(null);
  seated[0] = host;
  others.forEach((p, i) => {
    if (i < slots.length) seated[slots[i]] = p;
  });

  session.players = seated.map((p) => {
    if (p) {
      return { ...p, hand: [], score: 0, retired: false, hasOpened: false, dmMessageId: null, dmSignature: null };
    }
    return {
      id: null,
      name: 'ربات',
      hand: [],
      isBot: true,
      score: 0,
      retired: false,
      hasOpened: false,
      dmMessageId: null,
      dmSignature: null,
    };
  });
  session.seatCount = session.players.length;
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** اگر مخزن تمام شد، مخلفات (به‌جز رو‌کارت) دوباره درهم می‌خورد */
function refillStock(session: ScalaSession): boolean {
  if (session.stock.length > 0) return true;
  if (session.discard.length <= 1) return false;
  const top = session.discard.pop() as Card;
  session.stock = shuffleArray(session.discard);
  session.discard = [top];
  return session.stock.length > 0;
}

/** پخش کارت برای اولین دست + فرستادن دست‌ها در PV */
async function dealAndSendHands(ctx: Context, session: ScalaSession): Promise<boolean> {
  await startHand(session);

  let anyHuman = false;
  for (let seat = 0; seat < session.players.length; seat++) {
    const player = session.players[seat];
    if (player.isBot || !player.id) continue;
    const ok = await sendPrivateHand(ctx, session, seat);
    if (!ok) {
      session.notices.push(`⚠️ دستِ ${playerName(player)} قابل ارسال نبود؛ ربات جای او نشست.`);
      player.isBot = true;
      player.id = null;
      player.name = 'ربات';
      player.hand = [];
      player.dmMessageId = null;
    } else {
      anyHuman = true;
    }
  }
  if (!anyHuman) return false;

  // نوبت اول: بازیکنِ واقعیِ بعد از صندلی شروع
  session.turn = session.firstTurnSeat;
  if (session.players[session.turn].isBot || session.players[session.turn].retired) {
    session.turn = nextActiveSeat(session, session.firstTurnSeat);
  }
  session.phase = 'draw';
  session.turnNumber = 1;
  return true;
}

/** آماده‌سازی کارت‌ها و میز برای یک دست تازه */
async function startHand(session: ScalaSession): Promise<void> {
  const active = activeSeats(session);
  const seats = active.length >= 2 ? active : session.players.map((_, i) => i);
  const deal = dealScala(seats.length);

  session.players.forEach((p) => {
    p.hand = [];
    p.hasOpened = false;
    p.dmSignature = null;
  });
  seats.forEach((seat, i) => {
    session.players[seat].hand = deal.hands[i];
  });

  session.table = [];
  session.stock = deal.stock;
  session.discard = [deal.seed];
  session.phase = 'draw';
  session.selected = [];
  session.takenFromDiscard = null;
  session.owedJoker = null;
  session.jokerWarned = false;
  session.turnMeldPoints = 0;
  session.turnMelds = [];
  session.closedBy = null;
  session.turnNumber = 1;
  session.status = 'playing';
  session.createdAt = Date.now();

  // اولین نوبت بین بازیکنان ماندگار می‌چرخد
  const candidates = seats.filter((s) => !session.players[s].isBot && !session.players[s].retired);
  let start = session.firstTurnSeat;
  if (!candidates.includes(start)) start = candidates[0] ?? seats[0];
  session.firstTurnSeat = start;
  session.turn = start;
}

function nextActiveSeat(session: ScalaSession, from: number): number {
  const count = session.players.length;
  for (let step = 1; step <= count; step++) {
    const seat = (from + step) % count;
    if (!session.players[seat].retired) return seat;
  }
  return from;
}

/** بعد از تمام‌شدن نوبت یک بازیکن: نوبت بعدی و حرکت ربات‌ها */
async function afterTurn(ctx: Context, session: ScalaSession): Promise<void> {
  if (session.status !== 'playing') return;
  const next = nextActiveSeat(session, session.turn);
  session.turn = next;
  session.turnNumber++;
  session.phase = 'draw';
  session.selected = [];
  session.takenFromDiscard = null;
  session.owedJoker = null;
  session.jokerWarned = false;
  session.turnMeldPoints = 0;
  session.turnMelds = [];
  await syncAll(ctx, session);
  await driveBots(ctx, session);
}

/** مخزن و مخلفات هر دو تمام شده‌اند: دست بدون بستن تمام می‌شود */
async function exhaustStock(ctx: Context, session: ScalaSession): Promise<void> {
  await ctx.answerCbQuery('🤝 کارت‌ها تمام شد؛ این دست بدون بستن حساب می‌شود.');
  await finishHand(ctx, session, null);
}

// ─── Bot / auto play ─────────────────────────
/** یک نوبت کامل (بردن کارت، مخل، دور ریختن) برای یک صندلی */
async function autoPlaySeat(ctx: Context, session: ScalaSession, seat: number): Promise<void> {
  const player = session.players[seat];
  if (player.retired) return;

  if (!refillStock(session)) {
    await finishHand(ctx, session, null);
    return;
  }
  const drawn = session.stock.shift() as Card;
  player.hand.push(drawn);
  session.phase = 'meld';

  // مخل‌های خودش
  const picks = pickBestMelds(player.hand, player.hasOpened);
  for (const pick of picks) {
    if (player.hand.length - pick.cards.length < 1) continue;
    const check = resolveMeld(pick.cards, seat);
    if (!check.ok) continue;
    const ids = new Set(pick.cards.map((c) => c.id));
    player.hand = player.hand.filter((c) => !ids.has(c.id));
    session.table.push(check.meld);
    session.turnMelds.push(check.meld);
    session.turnMeldPoints += check.meld.points;
    if (!player.hasOpened && session.turnMeldPoints >= OPEN_POINTS) player.hasOpened = true;
  }

  // افزودن به میز
  if (player.hasOpened) {
    const layoffs = findLayoffs(player.hand, session.table);
    for (const item of layoffs) {
      const still = player.hand.find((c) => c.id === item.card.id);
      if (!still) continue;
      if (player.hand.length <= 1) break;
      const meld = session.table[item.meldIndex];
      const res = canLayOff(meld, still);
      if (!res.ok) continue;
      session.table[item.meldIndex] = applyLayOff(meld, still);
      player.hand = player.hand.filter((c) => c.id !== still.id);
      if (res.takesJoker && !session.owedJoker) {
        player.hand.push(res.takesJoker);
        session.owedJoker = res.takesJoker;
      }
    }
  }

  // مخل‌های باز‌نشده پس می‌رود
  if (!player.hasOpened && session.turnMeldPoints < OPEN_POINTS && session.turnMelds.length) {
    const back = session.turnMelds;
    session.table = session.table.filter((meld) => !back.includes(meld));
    for (const meld of back) player.hand.push(...meld.cards);
    session.turnMelds = [];
    session.turnMeldPoints = 0;
  }

  session.phase = 'discard';

  // بستن؟
  if (player.hand.length === 1 && player.hasOpened && session.turnNumber > 1) {
    const last = player.hand[0];
    player.hand = [];
    session.discard.push(last);
    await finishHand(ctx, session, seat);
    return;
  }

  const allowed = player.hand.filter((card) =>
    isDiscardAllowed(card, {
      hasOpened: player.hasOpened,
      takenFromDiscard: session.takenFromDiscard,
      owedJoker: session.owedJoker,
    }).ok
  );
  const list = allowed.length ? allowed : player.hand;
  const chosen = chooseBotDiscard(list);
  if (!chosen) {
    await finishHand(ctx, session, seat);
    return;
  }
  player.hand = player.hand.filter((c) => c.id !== chosen.id);
  session.discard.push(chosen);
  if (session.owedJoker && chosen.id === session.owedJoker.id) session.owedJoker = null;
}

/** تا وقتی نوبت ربات‌هاست، یکی‌یکی بازی می‌کنند */
async function driveBots(ctx: Context, session: ScalaSession): Promise<void> {
  if (session.busy) return;
  session.busy = true;
  try {
    let guard = 0;
    while (session.status === 'playing' && session.players[session.turn].isBot && guard < 200) {
      guard++;
      await sleep(320);
      const before = session.turn;
      await autoPlaySeat(ctx, session, before);
      if (session.status !== 'playing') break;
      const next = nextActiveSeat(session, session.turn);
      if (next === before && session.players[before].isBot) break;
      session.turn = next;
      session.turnNumber++;
      session.phase = 'draw';
      session.turnMeldPoints = 0;
      session.turnMelds = [];
      session.takenFromDiscard = null;
      session.owedJoker = null;
    }
  } finally {
    session.busy = false;
  }
  await syncAll(ctx, session);
}

// ─── Hand & match end ────────────────────────
async function finishHand(ctx: Context, session: ScalaSession, closeSeat: number | null): Promise<void> {
  const penalties: number[] = [];
  for (let seat = 0; seat < session.players.length; seat++) {
    const player = session.players[seat];
    const value = closeSeat === seat ? 0 : penaltyTotal(player.hand);
    penalties.push(value);
    if (closeSeat !== seat && !player.retired) player.score += value;
  }
  session.closedBy = closeSeat;
  session.lastHand = { seat: closeSeat, penalties };
  session.notices = [];

  // خارج‌شدنی‌ها
  for (const player of session.players) {
    if (!player.retired && player.score >= TARGET_POINTS) {
      player.retired = true;
      session.notices.push(`❌ ${playerName(player, false)} با ${faNum(player.score)} امتیاز از مسابقه خارج شد.`);
    }
  }

  const survivors = session.players.filter((p) => !p.retired);
  const humansLeft = survivors.filter((p) => !p.isBot && p.id !== null);

  // حالت تک‌دست: همان بسته = برنده
  if (session.mode === 'single') {
    session.winner = closeSeat !== null ? closeSeat : pickLowestScore(session);
    session.status = 'finished';
    await endMatch(ctx, session);
    return;
  }

  // مسابقه: باقی‌ماندن یک نفر = پایان
  if (survivors.length <= 1) {
    session.winner = survivors.length === 1 ? session.players.indexOf(survivors[0]) : pickLowestScore(session);
    session.status = 'finished';
    await endMatch(ctx, session);
    return;
  }

  // اگر همهٔ بازیکنان واقعی خارج شده‌اند، مسابقه با برندهٔ کیفریِ کم تمام می‌شود
  if (humansLeft.length === 0) {
    session.winner = pickLowestScore(session);
    session.status = 'finished';
    await endMatch(ctx, session);
    return;
  }

  session.status = 'handover';
  if (closeSeat !== null && closeSeat !== undefined) {
    await awardPoints(ctx, session.players[closeSeat], POINTS_PER_HAND, `بازی اسکالا — بستن دست ${faNum(session.handNumber)}`);
  }
  session.firstTurnSeat = nextActiveSeat(session, session.turn);

  for (let seat = 0; seat < session.players.length; seat++) {
    const player = session.players[seat];
    if (player.isBot || !player.id) continue;
    player.dmSignature = null;
    await sendPrivateHand(ctx, session, seat);
  }
}

function pickLowestScore(session: ScalaSession): number {
  let best = 0;
  for (let seat = 0; seat < session.players.length; seat++) {
    if (session.players[seat].retired) continue;
    if (session.players[seat].score < session.players[best].score) best = seat;
  }
  return best;
}

/** پایان مسابقه: امتیاز، پیام نتیجه در گروه، زمان‌بندی پاک‌سازی */
async function endMatch(ctx: Context, session: ScalaSession): Promise<void> {
  if (session.winner !== null) {
    const winner = session.players[session.winner];
    if (!winner.isBot && winner.id) {
      await awardPoints(ctx, winner, POINTS_MATCH_WIN, 'بازی اسکالا — برنده');
    }
  }
  await announceScalaResult(ctx, session);
  void purgeGameMessages(ctx.telegram, sessionKey(session.chatId), GAME_RESULT_PURGE_DELAY_MS);

  for (let seat = 0; seat < session.players.length; seat++) {
    const player = session.players[seat];
    if (player.isBot || !player.id) continue;
    player.dmSignature = null;
    await sendPrivateHand(ctx, session, seat);
  }
}

async function awardPoints(ctx: Context, player: ScalaPlayer, points: number, description: string) {
  if (!player.id) return;
  try {
    const user = await prisma.user.findFirst({
      where: { telegramId: BigInt(player.id), botId: (ctx as any).botId },
    });
    if (!user) return;
    await prisma.user.update({ where: { id: user.id }, data: { points: { increment: points } } });
    await prisma.pointTransaction.create({
      data: { userId: user.id, amount: points, type: 'BONUS', description },
    });
  } catch {}
}

// ─── Group board / PV ────────────────────────
async function clearGroupBoard(ctx: Context, session: ScalaSession): Promise<boolean> {
  if (session.boardCleared) return session.messageId === 0;
  session.boardCleared = true;
  if (!session.messageId) return true;

  const removed = await deleteGameMessage(
    ctx.telegram,
    sessionKey(session.chatId),
    session.chatId,
    session.messageId
  );
  if (removed) {
    session.messageId = 0;
    return true;
  }

  try {
    await ctx.telegram.editMessageText(
      session.chatId.toString(),
      session.messageId,
      undefined,
      '🔒 بازی *اسکالا* در *گفتگوی خصوصی* با ربات ادامه دارد.\n\nکارت‌ها، نوبت و نتیجه را همان‌جا می‌بینید.',
      { parse_mode: 'Markdown' }
    );
    await ctx.telegram.editMessageReplyMarkup(
      session.chatId.toString(),
      session.messageId,
      undefined,
      undefined
    );
  } catch {}
  return false;
}

async function announceScalaResult(ctx: Context, session: ScalaSession): Promise<void> {
  const key = sessionKey(session.chatId);
  const text = buildResultText(session);
  const extra = { parse_mode: 'Markdown', ...buildResultKeyboard() };
  const boardSurvived = !(await clearGroupBoard(ctx, session));

  if (boardSurvived && session.messageId) {
    try {
      await ctx.telegram.editMessageText(
        session.chatId.toString(),
        session.messageId,
        undefined,
        text,
        extra
      );
      trackGameMessage(key, session.chatId, session.messageId, ctx.telegram);
      return;
    } catch {}
  }

  const messageId = await postGameMessage(ctx.telegram, key, session.chatId, text, extra);
  if (typeof messageId === 'number') session.messageId = messageId;
}

function buildResultText(session: ScalaSession): string {
  const lines: string[] = [];
  lines.push('🏁 *اسکالا تمام شد*');
  lines.push('');
  if (session.winner !== null) {
    lines.push(`🏆 برنده: ${playerName(session.players[session.winner])}`);
  } else {
    lines.push('🤝 این بازی برنده‌ای نداشت.');
  }
  lines.push('');
  for (let seat = 0; seat < session.players.length; seat++) {
    const p = session.players[seat];
    const tag = p.retired ? ' — ❌ خارج شده' : '';
    lines.push(`• ${faNum(seat + 1)} ${playerName(p, false)}: ${faNum(p.score)} امتیاز کیفری${tag}`);
  }
  lines.push('');
  if (session.lastHand && session.lastHand.seat !== null) {
    lines.push(
      `🎯 آخرین دست را ${playerName(session.players[session.lastHand.seat], false)} بست.`
    );
  }
  lines.push(`⭐️ ${faNum(POINTS_MATCH_WIN)} امتیاز برای برنده`);
  lines.push('');
  lines.push('🔒 دست‌ها فقط در گفتگوی خصوصی بازیکنان افشا می‌شود.');
  lines.push('🧹 این پیام کمی بعد از گروه پاک می‌شود.');
  return lines.join('\n');
}

async function cancelScala(ctx: Context, session: ScalaSession): Promise<void> {
  const key = sessionKey(session.chatId);

  if (!session.boardCleared && session.messageId) {
    try {
      await ctx.telegram.editMessageText(
        session.chatId.toString(),
        session.messageId,
        undefined,
        '❌ بازی اسکالا لغو شد.',
        { parse_mode: 'Markdown' }
      );
      await ctx.telegram.editMessageReplyMarkup(
        session.chatId.toString(),
        session.messageId,
        undefined,
        undefined
      );
    } catch {}
  }

  void purgeGameMessages(ctx.telegram, key, GAME_CANCEL_PURGE_DELAY_MS);

  for (const player of session.players) {
    if (player.isBot || !player.id || !player.dmMessageId) continue;
    try {
      await ctx.telegram.editMessageText(
        player.id.toString(),
        player.dmMessageId,
        undefined,
        '❌ *بازی اسکالا لغو شد.*\n\nبرای بازی دوباره، در گروه دکمهٔ «🇮🇹 اسکالا» را بزنید.',
        { parse_mode: 'Markdown' }
      );
      await ctx.telegram.editMessageReplyMarkup(
        player.id.toString(),
        player.dmMessageId,
        undefined,
        undefined
      );
    } catch {}
  }
}

function resetScalaSession(session: ScalaSession): void {
  session.players = lobbyPlayers(session);
  session.status = 'waiting';
  session.table = [];
  session.stock = [];
  session.discard = [];
  session.turn = 0;
  session.phase = 'draw';
  session.selected = [];
  session.takenFromDiscard = null;
  session.owedJoker = null;
  session.jokerWarned = false;
  session.turnMeldPoints = 0;
  session.turnMelds = [];
  session.handNumber = 0;
  session.turnNumber = 0;
  session.firstTurnSeat = 0;
  session.closedBy = null;
  session.lastHand = null;
  session.winner = null;
  session.notices = [];
  session.busy = false;
  session.boardSignature = null;
  session.createdAt = Date.now();
}

// ─── Rendering ───────────────────────────────
async function syncAll(ctx: Context, session: ScalaSession): Promise<void> {
  await editGroupBoard(ctx, session);
  if (session.status === 'waiting') return;
  for (let seat = 0; seat < session.players.length; seat++) {
    const player = session.players[seat];
    if (player.isBot || !player.id) continue;
    await sendPrivateHand(ctx, session, seat);
  }
}

async function editGroupBoard(ctx: Context, session: ScalaSession): Promise<void> {
  if (session.boardCleared) return;
  const text = buildLobbyText(session);
  const keyboard = await buildLobbyKeyboard(ctx, session);
  const signature = text + JSON.stringify(keyboard.reply_markup);
  if (session.boardSignature === signature) return;

  try {
    await ctx.telegram.editMessageText(session.chatId.toString(), session.messageId, undefined, text, {
      parse_mode: 'Markdown',
      ...keyboard,
    });
    session.boardSignature = signature;
  } catch {}
}

// ─── Expiry ──────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > 3600000) {
      sessions.delete(key);
    }
  }
}, 60000);
