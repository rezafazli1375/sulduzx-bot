// ─── Hokm (حکم) — pure card logic ───

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export interface Card {
  suit: Suit;
  rank: number; // 2..14 (A = 14)
}

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

export const SUIT_EMOJI: Record<Suit, string> = {
  hearts: '❤️',
  diamonds: '♦️',
  clubs: '♣️',
  spades: '♠️',
};

export const SUIT_NAME_FA: Record<Suit, string> = {
  hearts: 'دل',
  diamonds: 'خشت',
  clubs: 'خاج',
  spades: 'پیک',
};

export const TRICK_POINTS_TO_WIN = 7;
export const TOTAL_TRICKS = 13;

export function cardLabel(card: Card): string {
  const rank =
    card.rank === 14
      ? 'A'
      : card.rank === 13
      ? 'K'
      : card.rank === 12
      ? 'Q'
      : card.rank === 11
      ? 'J'
      : String(card.rank);
  return `${SUIT_EMOJI[card.suit]}${rank}`;
}

export function cardNameFa(card: Card): string {
  return `${SUIT_NAME_FA[card.suit]} ${card.rank === 14 ? 'اَس' : card.rank}`;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ suit, rank });
  }
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

/** پخش استاندارد حکم: ۵ کارت، سپس ۴ کارت، سپس ۴ کارت (هر نفر ۱۳ کارت) */
export function dealHokmHands(): Card[][] {
  const deck = shuffle(createDeck());
  const hands: Card[][] = [[], [], [], []];
  let idx = 0;

  for (const batch of [5, 4, 4]) {
    for (let round = 0; round < batch; round++) {
      for (let seat = 0; seat < 4; seat++) {
        hands[seat].push(deck[idx++]);
      }
    }
  }

  return hands;
}

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => {
    if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    return a.rank - b.rank;
  });
}

/** شمارهٔ صندلیِ دارندهٔ اَس خال داده‌شده (حاکم) */
export function findAceHolder(hands: Card[][], suit: Suit): number {
  for (let seat = 0; seat < hands.length; seat++) {
    if (hands[seat].some((c) => c.suit === suit && c.rank === 14)) return seat;
  }
  return 0;
}

/** تیم هر صندلی: ۰ و ۲ در برابر ۱ و ۳ (هم‌تیمی‌ها روبه‌روی هم) */
export function teamOf(seat: number): 0 | 1 {
  return seat === 0 || seat === 2 ? 0 : 1;
}

export function isTrickComplete(trick: { card: Card | null }[]): boolean {
  return trick.every((t) => t.card !== null);
}

/** آیا این کارت مجاز است؟ (باید خال خواسته‌شده را بازی کرد) */
export function canPlayCard(
  card: Card,
  hand: Card[],
  trick: { card: Card | null }[],
  trumpSuit: Suit | null
): boolean {
  const played = trick.filter((t) => t.card !== null).map((t) => t.card!);
  if (played.length === 0) return true;

  const ledSuit = played[0].suit;
  const hasSuit = hand.some((c) => c.suit === ledSuit);
  if (hasSuit) return card.suit === ledSuit;

  // خال خواسته‌شده را نداریم → هر کارتی (حتی حکم) مجاز است
  return true;
}

/** برندهٔ تریک: حکم بر همه چیز، سپس بالاترین کارت خال اول */
export function determineTrickWinner(
  trick: { seat: number; card: Card | null }[],
  trumpSuit: Suit | null
): number {
  const played = trick.filter((t) => t.card !== null) as { seat: number; card: Card }[];
  if (played.length === 0) return -1;

  const ledSuit = played[0].card.suit;

  let winner = played[0];
  for (const play of played) {
    const isTrump = play.card.suit === trumpSuit;
    const winnerIsTrump = winner.card.suit === trumpSuit;

    if (isTrump && !winnerIsTrump) {
      winner = play;
    } else if (isTrump && winnerIsTrump) {
      if (play.card.rank > winner.card.rank) winner = play;
    } else if (!isTrump && !winnerIsTrump && play.card.suit === ledSuit) {
      if (play.card.rank > winner.card.rank) winner = play;
    }
  }

  return winner.seat;
}

/** انتخاب کارت ربات */
export function chooseBotCard(
  hand: Card[],
  trick: { seat: number; card: Card | null }[],
  trumpSuit: Suit,
  seat: number
): Card {
  const played = trick.filter((t) => t.card !== null) as { seat: number; card: Card }[];
  const teammateSeat = (seat + 2) % 4;
  const byRankAsc = (a: Card, b: Card) => a.rank - b.rank;

  // ── شروع تریک ──
  if (played.length === 0) {
    const aceTrump = hand.find((c) => c.suit === trumpSuit && c.rank === 14);
    if (aceTrump) return aceTrump;

    const counts = new Map<Suit, number>();
    for (const c of hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
    let bestSuit = hand[0].suit;
    let bestCount = 0;
    for (const [s, n] of counts) {
      if (n > bestCount) {
        bestCount = n;
        bestSuit = s;
      }
    }

    const suitCards = hand.filter((c) => c.suit === bestSuit);
    const lowOnes = suitCards.filter((c) => c.rank !== 14);
    const pool = lowOnes.length ? lowOnes : suitCards;
    return [...pool].sort(byRankAsc)[0];
  }

  const ledSuit = played[0].card.suit;
  const winnerSeat = determineTrickWinner(trick, trumpSuit);
  const teammateWinning = winnerSeat === teammateSeat;
  const ofSuit = hand.filter((c) => c.suit === ledSuit);

  // ── باید خال خواسته‌شده را بازی کند ──
  if (ofSuit.length > 0) {
    const highestLed = Math.max(
      ...played.filter((p) => p.card.suit === ledSuit).map((p) => p.card.rank)
    );
    const beating = ofSuit.filter((c) => c.rank > highestLed);

    if (teammateWinning) {
      // هم‌تیمی برنده است → کمترین کارت را بده
      return [...ofSuit].sort(byRankAsc)[0];
    }

    const strongLed = highestLed >= 12 || played.some((p) => p.card.suit === trumpSuit);
    if (strongLed && beating.length > 0) {
      // می‌توانیم تریک را پس بگیریم
      return [...beating].sort((a, b) => b.rank - a.rank)[0];
    }

    return [...ofSuit].sort(byRankAsc)[0];
  }

  // ── خال خواسته‌شده را ندارد ──
  const trumps = hand.filter((c) => c.suit === trumpSuit);
  const others = hand.filter((c) => c.suit !== trumpSuit);
  const trumpPlayed = played.some((p) => p.card.suit === trumpSuit);

  if (teammateWinning) {
    if (others.length) return [...others].sort(byRankAsc)[0];
    return [...trumps].sort(byRankAsc)[0];
  }

  if (trumpPlayed && trumps.length > 0) {
    // با حکم کوچک تریک را قطع کن
    return [...trumps].sort(byRankAsc)[0];
  }

  if (others.length) return [...others].sort(byRankAsc)[0];
  return [...trumps].sort(byRankAsc)[0];
}
