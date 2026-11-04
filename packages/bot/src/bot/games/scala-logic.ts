// ─── Scala Quaranta (اسکالا) — pure card logic ───
//
// قوانین از دو منبع معتبر بازی‌های کارتی گرفته شده است:
//   • pagat.com/rummy/scala40.html  (Scala 40 / Scala Quaranta)
//   • rummyrulebook.com/pages/scala-quaranta/
// خلاصهٔ قوانین که در این فایل پیاده شده:
//   • دو دست کارت (۱۰۴) + ۴ جایکر = ۱۰۸ کارت، به هر بازیکن ۱۳ کارت
//   • ارزش کارت در دست: ۲ تا ۱۰ = رویشان، S/Q/K = ۱۰، A = ۱۱ (در A-2-3 = ۱)، جایکر = ۲۵
//   • سری (اسکالا) = سه کارت یا بیشتر، پشت‌سرهم، هم‌خال — بدون دور شدن از K به A
//   • ست (کمبینازیونه) = ۳ تا ۴ کارت هم‌رتبه با خال‌های متفاوت
//   • در هر مخل حداکثر یک جایکر؛ جایکر ارزش کارتی را می‌گیرد که جایش نشسته
//   • برای «باز شدن» باید یک‌جا مخل‌هایی با مجموع دست‌کم ۴۰ امتیاز گذاشت
//   • تا باز نشده، افزودن به مخل‌های روی میز (لای‌آف) ممنوع
//   • جایکرِ روی میز با گذاشتن کارتِ جایش پس گرفته می‌شود و باید همان نوبت استفاده شود
//   • بستن بازی = دور ریختن آخرین کارت؛ در اولین نوبتِ دست ممکن نیست
//   • هر کارت فقط می‌تواند در یک مخل باشد؛ مخل‌ها بین همه مشترک است

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type CardSuit = Suit | 'joker';

export interface Card {
  /** شناسهٔ یکتا (۰..۱۰۷) — چون دو دست کارت در بازی است، خال و رتبه تنها کافی نیست */
  id: number;
  suit: CardSuit;
  /** ۲..۱۴ که A = ۱۴ برای کارت معمولی، و ۰ برای جایکر */
  rank: number;
}

/** یک مخل روی میز، با اطلاعاتی که افزودن/پس‌گرفتن جایکر را ممکن می‌کند */
export interface Meld {
  kind: 'scala' | 'combinazione';
  cards: Card[];
  ownerSeat: number;
  points: number;
  /** برای سری: خال مشترک و خانه‌های اشغال‌شده */
  suit?: Suit;
  lo?: number;
  hi?: number;
  /** رتبه‌ای که جایکر سرِ آن نشسته (سری)؛ در ست، خالِ جایکر مشخص نیست */
  jokerSlot?: number | null;
  /** برای ست: رتبهٔ مشترک و خال‌های حاضر */
  rank?: number;
  suits?: Suit[];
}

// ─── Constants ───────────────────────────────
export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

export const SUIT_EMOJI: Record<CardSuit, string> = {
  hearts: '❤️',
  diamonds: '♦️',
  clubs: '♣️',
  spades: '♠️',
  joker: '🃏',
};

export const SUIT_NAME_FA: Record<CardSuit, string> = {
  hearts: 'دل',
  diamonds: 'خشت',
  clubs: 'خاج',
  spades: 'پیک',
  joker: 'جایکر',
};

/** کارت‌های هر بازیکن */
export const HAND_SIZE = 13;
/** حداقل و حداکثر صندلی میز اسکالا در ربات */
export const MIN_SEATS = 2;
export const MAX_SEATS = 4;
/** حداقل امتیاز مخل‌های یک‌باره برای باز شدن */
export const OPEN_POINTS = 40;
/** رسیدن به این امتیاز = خارج شدن از مسابقه */
export const TARGET_POINTS = 101;
export const MAX_JOKERS_PER_MELD = 1;
export const MIN_MELD_CARDS = 3;
export const MAX_SET_CARDS = 4;

// ─── Labels ──────────────────────────────────
export function isJoker(card: Card): boolean {
  return card.suit === 'joker';
}

export function rankLabel(rank: number): string {
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  if (rank === 0) return '🃏';
  return String(rank);
}

/** برچسب کوتاه کارت برای دکمه و متن */
export function cardLabel(card: Card): string {
  if (isJoker(card)) return '🃏';
  return `${SUIT_EMOJI[card.suit]}${rankLabel(card.rank)}`;
}

/**
 * برچسب‌های دست؛ اگر دو نسخهٔ یک کارت در دست باشد (دو دست کارت داریم)
 * با بالانویس ¹ و ² از هم جدا می‌شوند تا بازیکن بداند کدام را انتخاب کرده است.
 */
export function handLabels(cards: Card[]): string[] {
  const counts = new Map<string, number>();
  for (const c of cards) {
    if (isJoker(c)) continue;
    const key = `${c.suit}-${c.rank}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const SUP = ['¹', '²', '³', '⁴'];
  return cards.map((c) => {
    if (isJoker(c)) return cardLabel(c);
    const key = `${c.suit}-${c.rank}`;
    if ((counts.get(key) ?? 1) < 2) return cardLabel(c);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return cardLabel(c) + (SUP[n] ?? '');
  });
}

// ─── Values ──────────────────────────────────
/** ارزش کارت وقتی هنوز در دست بازیکن است (امتیاز کیفری پایان دست) */
export function handValue(card: Card): number {
  if (isJoker(card)) return 25;
  if (card.rank === 14) return 11;
  if (card.rank >= 11) return 10;
  return card.rank;
}

/** ارزش یک رتبه وقتی بخشی از مخل است (۱ = اَس پایینِ سری A-2-3) */
export function meldValueOfRank(rank: number): number {
  if (rank === 1) return 1;
  if (rank === 14) return 11;
  if (rank >= 11) return 10;
  return rank;
}

/** مجموع ارزش کیفری یک دست */
export function penaltyTotal(hand: Card[]): number {
  return hand.reduce((sum, c) => sum + handValue(c), 0);
}

// ─── Deck ────────────────────────────────────
export function createScalaDeck(): Card[] {
  const deck: Card[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) {
        deck.push({ id: deck.length, suit, rank });
      }
    }
  }
  for (let j = 0; j < 4; j++) deck.push({ id: deck.length, suit: 'joker', rank: 0 });
  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** پخش کارت: ۴ تا، بعد ۴ تا، در پایان ۵ تا (جمعاً ۱۳ کارت به هر صندلی) */
export interface ScalaDeal {
  hands: Card[][];
  /** مخزن؛ اولین کارتِ این آرایه اولین کارتی است که برداشته می‌شود */
  stock: Card[];
  /** یک کارت رو می‌شود و پایهٔ مخلفات است */
  seed: Card;
}

export function dealScala(seatCount: number): ScalaDeal {
  const deck = shuffle(createScalaDeck());
  const hands: Card[][] = [];
  for (let s = 0; s < seatCount; s++) hands.push([]);
  let idx = 0;
  for (const batch of [4, 4, 5]) {
    for (let n = 0; n < batch; n++) {
      for (let s = 0; s < seatCount; s++) hands[s].push(deck[idx++]);
    }
  }
  const rest = deck.slice(idx);
  const seed = rest.pop() as Card;
  return { hands, stock: rest, seed };
}

const SUIT_ORDER = [...SUITS, 'joker'] as CardSuit[];

/** مرتب‌کردن دست: خال‌ها پشت‌سرهم، جایکر آخر، داخل هر خال از کوچک به بزرگ */
export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => {
    const sa = SUIT_ORDER.indexOf(a.suit);
    const sb = SUIT_ORDER.indexOf(b.suit);
    if (sa !== sb) return sa - sb;
    return a.rank - b.rank;
  });
}

// ─── Meld resolution ─────────────────────────
interface ScalaShape {
  suit: Suit;
  lo: number;
  hi: number;
  points: number;
  jokerSlot: number | null;
}

/**
 * آیا این کارت‌ها یک سری (اسکالا) می‌سازند؟
 * کارت‌های واقعی باید هم‌خال باشند و روی خانه‌های پیوستهٔ یک بازهٔ Lتایی بنشینند؛
 * جایکر (حداکثر یکی) خانهٔ خالی را پر می‌کند. اَس می‌تواند ۱ باشد (A-2-3) یا ۱۴ (Q-K-A)
 * و دورِ K→A→2 مجاز نیست، چون خانه‌ها هرگز از ۱۴ بیرون نمی‌زنند.
 */
function resolveScalaShape(cards: Card[]): ScalaShape | null {
  const jokers = cards.filter(isJoker);
  const real = cards.filter((c) => !isJoker(c));
  if (jokers.length > MAX_JOKERS_PER_MELD) return null;
  if (cards.length < MIN_MELD_CARDS) return null;
  if (real.length < 2) return null;

  const suit = real[0].suit;
  if (suit === 'joker') return null;
  if (real.some((c) => c.suit !== suit)) return null;

  const length = cards.length;
  const aceIndexes = real.map((c, i) => (c.rank === 14 ? i : -1)).filter((i) => i >= 0);

  // چند بازه می‌تواند کارت‌های واقعی را جا بدهد (تنها وقتی جایکر در دست است).
  // بازه‌ای را برمی‌گزینیم که جایکر گران‌ترین خانهٔ ممکن را بگیرد؛ یعنی
  // [۵♣ ۶♣ + جایکر] سریِ ۵-۶-۷ می‌شود (۱۸) نه ۴-۵-۶ (۱۵).
  let best: ScalaShape | null = null;

  for (let mask = 0; mask < 1 << aceIndexes.length; mask++) {
    const values = real.map((c) => c.rank);
    aceIndexes.forEach((idx, bit) => {
      if (mask & (1 << bit)) values[idx] = 1;
    });

    for (let lo = 1; lo + length - 1 <= 14; lo++) {
      const hi = lo + length - 1;
      const used = new Set<number>();
      let fits = true;
      for (const v of values) {
        if (v < lo || v > hi || used.has(v)) {
          fits = false;
          break;
        }
        used.add(v);
      }
      if (!fits) continue;
      if (length - used.size !== jokers.length) continue;

      let jokerSlot: number | null = null;
      let points = 0;
      for (let r = lo; r <= hi; r++) {
        points += meldValueOfRank(r);
        if (!used.has(r)) jokerSlot = r;
      }
      const shape: ScalaShape = {
        suit: suit as Suit,
        lo,
        hi,
        points,
        jokerSlot: jokers.length ? jokerSlot : null,
      };
      if (!best || shapeScoreRank(shape) > shapeScoreRank(best)) best = shape;
    }
  }
  return best;
}

/** معیار ترجیح بازه: امتیاز بیشتر، و در تساوی بازهٔ پایین‌تر */
function shapeScoreRank(shape: ScalaShape): number {
  return shape.points * 100 + (15 - shape.lo);
}

interface SetShape {
  rank: number;
  suits: Suit[];
  points: number;
}

/** ست (کمبینازیونه): ۳ تا ۴ کارت هم‌رتبه با خال‌های متفاوت + حداکثر یک جایکر */
function resolveSetShape(cards: Card[]): SetShape | null {
  const jokers = cards.filter(isJoker);
  const real = cards.filter((c) => !isJoker(c));
  if (jokers.length > MAX_JOKERS_PER_MELD) return null;
  if (cards.length < MIN_MELD_CARDS || cards.length > MAX_SET_CARDS) return null;
  if (real.length < 2) return null;

  const rank = real[0].rank;
  if (real.some((c) => c.rank !== rank)) return null;
  const suits = real.map((c) => c.suit as Suit);
  if (new Set(suits).size !== suits.length) return null;

  return { rank, suits, points: cards.length * meldValueOfRank(rank) };
}

export type MeldCheck =
  | { ok: true; meld: Meld }
  | { ok: false; error: string };

/** بررسی یک مخل پیشنهادی و ساختن ساختار نهایی آن */
export function resolveMeld(cards: Card[], ownerSeat: number): MeldCheck {
  if (cards.length < MIN_MELD_CARDS) {
    return { ok: false, error: 'برای مخل دست‌کم سه کارت لازم است.' };
  }
  if (new Set(cards.map((c) => c.id)).size !== cards.length) {
    return { ok: false, error: 'یک کارت دوبار انتخاب شده است.' };
  }

  const scala = resolveScalaShape(cards);
  if (scala) {
    return {
      ok: true,
      meld: {
        kind: 'scala',
        cards: [...cards],
        ownerSeat,
        points: scala.points,
        suit: scala.suit,
        lo: scala.lo,
        hi: scala.hi,
        jokerSlot: scala.jokerSlot,
      },
    };
  }

  const set = resolveSetShape(cards);
  if (set) {
    return {
      ok: true,
      meld: {
        kind: 'combinazione',
        cards: [...cards],
        ownerSeat,
        points: set.points,
        rank: set.rank,
        suits: set.suits,
        jokerSlot: null,
      },
    };
  }

  const jokers = cards.filter(isJoker).length;
  if (jokers > MAX_JOKERS_PER_MELD) {
    return { ok: false, error: 'در هر مخل فقط یک جایکر مجاز است.' };
  }
  const suits = new Set(cards.filter((c) => !isJoker(c)).map((c) => c.suit));
  if (suits.size > 1) {
    return { ok: false, error: 'کارت‌های سری باید هم‌خال و پشت‌سرهم باشند.' };
  }
  return { ok: false, error: 'این کارت‌ها نه سری می‌سازند نه ست.' };
}

// ─── Lay-off / joker swap ────────────────────
export interface LayOffResult {
  ok: boolean;
  /** امتیازی که این کارت به میز اضافه می‌کند (برای باز شدن شمرده نمی‌شود) */
  points: number;
  /** اگر کارت جای جایکر را گرفت، خودِ جایکر پس داده می‌شود */
  takesJoker: Card | null;
  reason: string;
}

function findJoker(meld: Meld): Card | null {
  return meld.cards.find(isJoker) ?? null;
}

/** خانه(های) ممکنِ یک کارت داخل سری؛ اَس هم می‌تواند ۱ باشد هم ۱۴ */
function cardSlots(card: Card): number[] {
  return card.rank === 14 ? [1, 14] : [card.rank];
}

/**
 * آیا این کارتِ دست روی یکی از مخل‌های میز می‌نشیند؟
 * دو حالت: افزودن معمولی (سری بلندتر می‌شود / ست چهارمی می‌گیرد)
 * یا پس‌گرفتن جایکر با گذاشتن کارتی که جایکر سرِ آن نشسته است.
 */
export function canLayOff(meld: Meld, card: Card): LayOffResult {
  if (card.suit === 'joker') {
    return { ok: false, points: 0, takesJoker: null, reason: 'جایکر را نمی‌توان روی میز افزود.' };
  }
  if (meld.cards.some((c) => c.id === card.id)) {
    return { ok: false, points: 0, takesJoker: null, reason: 'این کارت روی میز است.' };
  }

  if (meld.kind === 'scala') {
    if (card.suit !== meld.suit) {
      return { ok: false, points: 0, takesJoker: null, reason: 'باید هم‌خالِ سری باشد.' };
    }
    const lo = meld.lo ?? 0;
    const hi = meld.hi ?? 0;
    const slots = cardSlots(card);
    const joker = meld.jokerSlot != null ? findJoker(meld) : null;
    if (joker && meld.jokerSlot != null && slots.includes(meld.jokerSlot)) {
      return { ok: true, points: 0, takesJoker: joker, reason: 'جایکر پس گرفته می‌شود' };
    }
    const ends = [lo - 1, hi + 1].filter((r) => r >= 1 && r <= 14);
    const slot = slots.find((s) => ends.includes(s));
    if (slot === undefined) {
      return { ok: false, points: 0, takesJoker: null, reason: 'فقط یک سرِ سری جای افزودن دارد.' };
    }
    return { ok: true, points: meldValueOfRank(slot), takesJoker: null, reason: 'سری بلندتر می‌شود' };
  }

  // combinazione
  const rank = meld.rank ?? 0;
  if (card.rank !== rank) {
    return { ok: false, points: 0, takesJoker: null, reason: 'باید هم‌رتبهٔ ست باشد.' };
  }
  const suits = meld.suits ?? [];
  if (suits.includes(card.suit as Suit)) {
    return { ok: false, points: 0, takesJoker: null, reason: 'خال این کارت در ست هست.' };
  }
  const joker = findJoker(meld);
  if (joker) {
    return { ok: true, points: 0, takesJoker: joker, reason: 'جایکر پس گرفته می‌شود' };
  }
  if (meld.cards.length >= MAX_SET_CARDS) {
    return { ok: false, points: 0, takesJoker: null, reason: 'ست چهارتایی کامل است.' };
  }
  return { ok: true, points: meldValueOfRank(rank), takesJoker: null, reason: 'ست کامل‌تر می‌شود' };
}

/** مخل میز را با کارت جدید به‌روز می‌کند (ورودی‌ها تغییر نمی‌کنند) */
export function applyLayOff(meld: Meld, card: Card): Meld {
  const reclaim = canLayOff(meld, card).takesJoker;

  if (meld.kind === 'combinazione') {
    // با پس‌گرفتن جایکر، طول ست عوض نمی‌شود: کارت واقعی جایش می‌نشیند
    const kept = reclaim ? meld.cards.filter((c) => c.id !== reclaim.id) : meld.cards;
    const cards = [...kept, card];
    const suits = [...(meld.suits ?? []).filter((s) => s !== card.suit), card.suit as Suit];
    return { ...meld, cards, suits, points: cards.length * meldValueOfRank(meld.rank ?? card.rank) };
  }

  const cards = reclaim
    ? [...meld.cards.filter((c) => c.id !== reclaim.id), card]
    : [...meld.cards, card];
  const shape = resolveScalaShape(cards);
  if (shape) {
    return {
      ...meld,
      cards,
      suit: shape.suit,
      lo: shape.lo,
      hi: shape.hi,
      points: shape.points,
      jokerSlot: shape.jokerSlot,
    };
  }
  return { ...meld, cards };
}

// ─── Bot helpers ─────────────────────────────
export interface MeldCandidate {
  cards: Card[];
  points: number;
}

/** همهٔ مخل‌های ممکن از یک دست (سری‌ها تا ۸ کارت، ست‌ها ۳ یا ۴ کارت) */
export function findCandidateMelds(hand: Card[]): MeldCandidate[] {
  const out: MeldCandidate[] = [];
  const jokers = hand.filter(isJoker);
  const jokerPool = jokers.slice(0, MAX_JOKERS_PER_MELD);

  // ── سری‌ها ──
  for (const suit of SUITS) {
    const byValue = new Map<number, Card>();
    for (const c of hand) {
      if (c.suit !== suit) continue;
      // اَس هم خانهٔ ۱۴ و هم خانهٔ ۱ می‌گیرد
      if (!byValue.has(c.rank)) byValue.set(c.rank, c);
      if (c.rank === 14 && !byValue.has(1)) byValue.set(1, c);
    }
    if (byValue.size < 2) continue;

    for (let lo = 1; lo <= 14; lo++) {
      for (let length = MIN_MELD_CARDS; length <= 8; length++) {
        const hi = lo + length - 1;
        if (hi > 14) break;
        const cards: Card[] = [];
        let missing = 0;
        for (let r = lo; r <= hi; r++) {
          const card = byValue.get(r);
          if (card) cards.push(card);
          else missing++;
        }
        if (cards.length < 2) continue;
        if (missing === 0 || (missing === 1 && jokerPool.length === 1)) {
          const meldCards = [...cards, ...(missing === 1 ? [jokerPool[0]] : [])];
          const check = resolveMeld(meldCards, -1);
          if (check.ok) out.push({ cards: meldCards, points: check.meld.points });
        }
      }
    }
  }

  // ── ست‌ها ──
  const byRank = new Map<number, Card[]>();
  for (const c of hand) {
    if (isJoker(c)) continue;
    const list = byRank.get(c.rank) ?? [];
    list.push(c);
    byRank.set(c.rank, list);
  }
  for (const [rank, cards] of byRank) {
    const distinct: Card[] = [];
    const usedSuits = new Set<Suit>();
    for (const c of cards) {
      if (usedSuits.has(c.suit as Suit)) continue;
      usedSuits.add(c.suit as Suit);
      distinct.push(c);
    }
    if (distinct.length >= MIN_MELD_CARDS) {
      for (let take = MIN_MELD_CARDS; take <= Math.min(MAX_SET_CARDS, distinct.length); take++) {
        const meldCards = distinct.slice(0, take);
        const check = resolveMeld(meldCards, -1);
        if (check.ok) out.push({ cards: meldCards, points: check.meld.points });
      }
    }
    if (distinct.length === 2 && jokerPool.length === 1) {
      const meldCards = [...distinct, jokerPool[0]];
      const check = resolveMeld(meldCards, -1);
      if (check.ok) out.push({ cards: meldCards, points: check.meld.points });
    }
  }

  out.sort((a, b) => b.points - a.points || b.cards.length - a.cards.length);
  return out;
}

/**
 * بهترین انتخاب‌های ربات: مخل‌های غیرهمپوشان با بیشترین امتیاز.
 * اگر بازیکن هنوز باز نشده، فقط مجموعه‌ای که مجموعش ≥ ۴۰ باشد انتخاب می‌شود.
 */
export function pickBestMelds(hand: Card[], hasOpened: boolean): MeldCandidate[] {
  const candidates = findCandidateMelds(hand);
  if (candidates.length === 0) return [];

  const greedy: MeldCandidate[] = [];
  const used = new Set<number>();
  for (const c of candidates) {
    if (c.cards.some((card) => used.has(card.id))) continue;
    c.cards.forEach((card) => used.add(card.id));
    greedy.push(c);
  }
  const greedyTotal = greedy.reduce((s, c) => s + c.points, 0);

  if (hasOpened || greedyTotal >= OPEN_POINTS) return greedy;

  // هنوز باز نشده: دنبال ترکیبی بگرد که مجموعش به ۴۰ برسد
  const top = candidates.slice(0, 12);
  let best: MeldCandidate[] = [];
  let bestTotal = 0;
  const disjoint = (a: MeldCandidate, list: MeldCandidate[]) =>
    list.every((b) => !a.cards.some((card) => b.cards.some((x) => x.id === card.id)));

  for (let i = 0; i < top.length; i++) {
    const single = top[i];
    if (single.points >= OPEN_POINTS && single.points > bestTotal) {
      best = [single];
      bestTotal = single.points;
    }
    for (let j = i + 1; j < top.length; j++) {
      if (!disjoint(top[j], [single])) continue;
      const pairTotal = single.points + top[j].points;
      if (pairTotal >= OPEN_POINTS && pairTotal > bestTotal) {
        best = [single, top[j]];
        bestTotal = pairTotal;
      }
      for (let k = j + 1; k < top.length; k++) {
        if (!disjoint(top[k], [single, top[j]])) continue;
        const tripleTotal = pairTotal + top[k].points;
        if (tripleTotal >= OPEN_POINTS && tripleTotal > bestTotal) {
          best = [single, top[j], top[k]];
          bestTotal = tripleTotal;
        }
      }
    }
  }
  return best;
}

/** هر کارتِ دست که روی مخل‌های میز می‌نشیند (ربات و راهنمای بازیکن) */
export function findLayoffs(
  hand: Card[],
  table: Meld[]
): { card: Card; meldIndex: number; takesJoker: Card | null }[] {
  const out: { card: Card; meldIndex: number; takesJoker: Card | null }[] = [];
  for (const card of hand) {
    for (let i = 0; i < table.length; i++) {
      const res = canLayOff(table[i], card);
      if (res.ok) out.push({ card, meldIndex: i, takesJoker: res.takesJoker });
    }
  }
  return out;
}

/** کارتِ کیفریِ سنگین‌تر برای دور ریختن (ربات) */
export function chooseBotDiscard(allowed: Card[]): Card | null {
  if (allowed.length === 0) return null;
  return [...allowed].sort((a, b) => handValue(b) - handValue(a))[0];
}

/** آیا بازیکن می‌تواند این کارت را دور بریزد؟ */
export function isDiscardAllowed(
  card: Card,
  opts: { hasOpened: boolean; takenFromDiscard: Card | null; owedJoker: Card | null }
): { ok: boolean; reason: string } {
  if (opts.owedJoker && card.id !== opts.owedJoker.id) {
    return { ok: false, reason: 'جایکرِ پس‌گرفته‌شده باید همین نوبت دور ریخته شود.' };
  }
  if (opts.owedJoker && card.id === opts.owedJoker.id) {
    return { ok: true, reason: 'بازگرداندن جایکر' };
  }
  if (!opts.hasOpened && isJoker(card)) {
    return { ok: false, reason: 'تا باز نشوی نمی‌توانی جایکر دور بریزی.' };
  }
  if (opts.takenFromDiscard && card.id === opts.takenFromDiscard.id) {
    return { ok: false, reason: 'کارتی را که از مخلفات برداشته‌ای نمی‌توانی همان‌جا برگردانی.' };
  }
  return { ok: true, reason: '' };
}
