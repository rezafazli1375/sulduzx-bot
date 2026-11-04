// ─── منچ (Mench / Ludo) — pure game logic ───────────────────
// No Telegram imports here: everything is deterministic and unit-testable.
//
// Board model (verified against the standard Ludo board):
//   • shared track  = 52 cells, numbered 0..51 around the ring
//   • start cells   = 0 / 13 / 26 / 39  (one per colour, 13 cells apart)
//   • star cells    = 8 / 21 / 34 / 47  (STAR_OFFSET after every start)
//   • home column   = 5 private cells + the centre goal
//   • a token needs 56 moves from its start cell to reach the goal,
//     so an exact roll is always required for the last step.

export const TRACK_SIZE = 52;
export const QUADRANT_SIZE = 13;
export const STAR_OFFSET = 8;

export const BASE = -1; // still in the player's yard
export const RING_LAST = 50; // last relative index on the shared track
export const HOME_FIRST = 51; // first cell of the private home column
export const HOME_LAST = 55; // last cell of the home column
export const GOAL = 56; // the centre — token is finished

export const TOKENS_PER_PLAYER = 4;
export const MIN_ROLL_TO_ENTER = 6;
export const MAX_SIXES_IN_A_ROW = 3;

export type MenchColor = 'red' | 'green' | 'yellow' | 'blue';

export const COLORS: MenchColor[] = ['red', 'green', 'yellow', 'blue'];

export const COLOR_EMOJI: Record<MenchColor, string> = {
  red: '🔴',
  green: '🟢',
  yellow: '🟡',
  blue: '🔵',
};

export const COLOR_NAME_FA: Record<MenchColor, string> = {
  red: 'قرمز',
  green: 'سبز',
  yellow: 'زرد',
  blue: 'آبی',
};

export const DIE_FACE: Record<number, string> = {
  1: '⚀',
  2: '⚁',
  3: '⚂',
  4: '⚃',
  5: '⚄',
  6: '⚅',
};

// ─── State ───────────────────────────────────
export interface MenchToken {
  color: MenchColor;
  index: number; // 0..3 → «مهرهٔ ۱»..«مهرهٔ ۴»
  rel: number; // BASE | 0..GOAL — progress along this colour's own route
}

export interface MenchState {
  colors: MenchColor[]; // one colour per seat, in seat order
  tokens: MenchToken[];
}

export interface MenchMove {
  tokenIndex: number;
  fromRel: number;
  toRel: number;
  destCell: number | null; // null → home column / goal
  captured: { color: MenchColor; tokenIndex: number }[];
  leavesBase: boolean;
  entersHome: boolean;
  reachesGoal: boolean;
}

export function faNum(value: number): string {
  const digits = '۰۱۲۳۴۵۶۷۸۹';
  return String(value).replace(/[0-9]/g, (d) => digits[Number(d)]);
}

// ─── Table setup ─────────────────────────────
/**
 * Colours per table size. Two players sit opposite each other (the
 * classic 2-player Ludo setup); three players take three corners.
 */
export function colorsForSeats(seatCount: number): MenchColor[] {
  if (seatCount <= 2) return ['red', 'yellow'];
  if (seatCount === 3) return ['red', 'green', 'yellow'];
  return ['red', 'green', 'yellow', 'blue'];
}

export function createState(seatCount: number): MenchState {
  const colors = colorsForSeats(seatCount);
  const tokens: MenchToken[] = [];
  for (const color of colors) {
    for (let index = 0; index < TOKENS_PER_PLAYER; index++) {
      tokens.push({ color, index, rel: BASE });
    }
  }
  return { colors, tokens };
}

// ─── Geometry ────────────────────────────────
export function startCell(color: MenchColor): number {
  return (COLORS.indexOf(color) * QUADRANT_SIZE) % TRACK_SIZE;
}

/** Absolute track cell for a relative index, or null inside the home column. */
export function cellOf(color: MenchColor, rel: number): number | null {
  if (rel < 0 || rel > RING_LAST) return null;
  return (startCell(color) + rel) % TRACK_SIZE;
}

/** Relative index of a track cell for a colour, or null when out of range. */
export function relOfCell(color: MenchColor, cell: number): number {
  return (cell - startCell(color) + TRACK_SIZE) % TRACK_SIZE;
}

export function isStarCell(cell: number): boolean {
  return ((cell % TRACK_SIZE) % QUADRANT_SIZE) === STAR_OFFSET;
}

/** The colour whose start cell this is, or null. */
export function startOwner(cell: number): MenchColor | null {
  if (cell % QUADRANT_SIZE !== 0) return null;
  return COLORS[(cell / QUADRANT_SIZE) % COLORS.length];
}

/**
 * Star cells protect everybody; a coloured start cell protects only its owner
 * (that is the rule Iranian players know: خانهٔ شروع برای صاحبش امن است).
 */
export function isSafeFor(color: MenchColor, cell: number | null): boolean {
  if (cell === null) return true; // home column is always safe
  if (isStarCell(cell)) return true;
  return startOwner(cell) === color;
}

export function tokensOf(state: MenchState, color: MenchColor): MenchToken[] {
  return state.tokens.filter((t) => t.color === color);
}

export function tokenAt(state: MenchState, color: MenchColor, index: number): MenchToken | undefined {
  return state.tokens.find((t) => t.color === color && t.index === index);
}

/** All tokens standing on one track cell. */
export function occupantsAt(state: MenchState, cell: number): MenchToken[] {
  return state.tokens.filter((t) => t.rel >= 0 && t.rel <= RING_LAST && cellOf(t.color, t.rel) === cell);
}

/** Tokens of one colour parked in one home-column slot (rel 51..55). */
export function homeColumnTokens(state: MenchState, color: MenchColor, rel: number): MenchToken[] {
  return state.tokens.filter((t) => t.color === color && t.rel === rel);
}

export function inBaseCount(state: MenchState, color: MenchColor): number {
  return tokensOf(state, color).filter((t) => t.rel === BASE).length;
}

export function finishedCount(state: MenchState, color: MenchColor): number {
  return tokensOf(state, color).filter((t) => t.rel === GOAL).length;
}

export function allHome(state: MenchState, color: MenchColor): boolean {
  return finishedCount(state, color) === TOKENS_PER_PLAYER;
}

export function rollDie(): number {
  return 1 + Math.floor(Math.random() * 6);
}

// ─── Legal moves ─────────────────────────────
/**
 * A move is legal when:
 *  • a token still in the yard may only come out on a 6, and only if no
 *    token of the same colour already sits on the start cell;
 *  • a token on the course moves exactly `roll` cells and may not overshoot
 *    the goal (an exact roll is required to finish);
 *  • two tokens of the same colour may never share a cell (no blocking);
 *  • opponents standing on the destination are captured, unless the cell is
 *    safe for them.
 */
export function legalMoves(state: MenchState, color: MenchColor, roll: number): MenchMove[] {
  if (roll < 1 || roll > 6) return [];
  const moves: MenchMove[] = [];

  for (const token of tokensOf(state, color)) {
    if (token.rel === GOAL) continue;

    if (token.rel === BASE) {
      if (roll !== MIN_ROLL_TO_ENTER) continue;
      const dest = startCell(color);
      if (occupantsAt(state, dest).some((t) => t.color === color)) continue;
      moves.push({
        tokenIndex: token.index,
        fromRel: BASE,
        toRel: 0,
        destCell: dest,
        captured: captureAt(state, color, dest),
        leavesBase: true,
        entersHome: false,
        reachesGoal: false,
      });
      continue;
    }

    const toRel = token.rel + roll;
    if (toRel > GOAL) continue; // needs the exact number

    const destCell = toRel <= RING_LAST ? cellOf(color, toRel) : null;

    if (destCell !== null) {
      // own tokens may not stack
      if (occupantsAt(state, destCell).some((t) => t.color === color)) continue;
    } else if (toRel <= HOME_LAST) {
      // the home column holds one token per cell; the centre goal is not a cell
      const own = homeColumnTokens(state, color, toRel);
      if (own.length > 0) continue;
    }

    moves.push({
      tokenIndex: token.index,
      fromRel: token.rel,
      toRel,
      destCell,
      captured: destCell === null ? [] : captureAt(state, color, destCell),
      leavesBase: false,
      entersHome: token.rel <= RING_LAST && toRel >= HOME_FIRST,
      reachesGoal: toRel === GOAL,
    });
  }

  return moves;
}

function captureAt(state: MenchState, color: MenchColor, cell: number) {
  // Safety belongs to the victim: a star is safe for everybody and a coloured
  // start cell is safe only for the tokens of its own colour.
  return occupantsAt(state, cell)
    .filter((t) => t.color !== color && !isSafeFor(t.color, cell))
    .map((t) => ({ color: t.color, tokenIndex: t.index }));
}

export interface MoveResult {
  move: MenchMove;
  capturedNames: { color: MenchColor; tokenIndex: number }[];
  finished: boolean; // this colour just brought all four tokens home
}

/** Applies a move in place and reports what happened. */
export function applyMove(state: MenchState, color: MenchColor, move: MenchMove): MoveResult {
  const token = tokenAt(state, color, move.tokenIndex);
  if (!token) return { move, capturedNames: [], finished: false };

  token.rel = move.toRel;

  for (const victim of move.captured) {
    const vt = tokenAt(state, victim.color, victim.tokenIndex);
    if (vt) vt.rel = BASE;
  }

  return {
    move,
    capturedNames: move.captured,
    finished: allHome(state, color),
  };
}

// ─── Threats ─────────────────────────────────
/** How many opponent tokens could land on `cell` on their next throw. */
export function threatLevel(state: MenchState, color: MenchColor, cell: number | null): number {
  if (cell === null) return 0;
  if (isSafeFor(color, cell)) return 0;
  let threats = 0;
  for (const other of state.colors) {
    if (other === color) continue;
    for (const token of tokensOf(state, other)) {
      if (token.rel === BASE || token.rel > RING_LAST) continue;
      // opponents travel the same ring; anything 1..6 cells behind us is danger
      for (let roll = 1; roll <= 6; roll++) {
        if (cellOf(other, token.rel + roll) === cell && token.rel + roll <= RING_LAST) {
          threats++;
          break;
        }
      }
    }
  }
  return threats;
}

// ─── Bot player ──────────────────────────────
/**
 * Simple but sensible heuristics: send opponents home, run for the goal,
 * hide on safe cells and stay out of reach.
 */
export function chooseBotMove(
  state: MenchState,
  color: MenchColor,
  roll: number,
  moves: MenchMove[] = legalMoves(state, color, roll)
): MenchMove | null {
  if (moves.length === 0) return null;

  let best: MenchMove | null = null;
  let bestScore = -Infinity;

  for (const move of moves) {
    let score = 0;

    if (move.leavesBase) score += 26;
    if (move.reachesGoal) score += 90;
    if (move.entersHome) score += 34;

    for (const victim of move.captured) {
      const vt = tokenAt(state, victim.color, victim.tokenIndex);
      score += 70 + (vt ? Math.max(0, vt.rel) : 0);
    }

    if (move.destCell !== null && isSafeFor(color, move.destCell)) score += 18;
    score -= threatLevel(state, color, move.destCell) * 22;

    // push the tokens that are already furthest along
    score += move.toRel / 6;

    if (inBaseCount(state, color) > 2 && !move.leavesBase && move.fromRel < 6) score += 4;

    if (
      score > bestScore ||
      (score === bestScore && best !== null && move.toRel > best.toRel) ||
      (score === bestScore && best !== null && move.toRel === best.toRel && move.tokenIndex < best.tokenIndex)
    ) {
      bestScore = score;
      best = move;
    }
  }

  return best;
}

// ─── Rendering helpers (text only, no Telegram) ──
export const CELL_EMPTY = '⬜';
export const CELL_STAR = '⭐';
export const CELL_GOAL = '🏁';

/** One ring cell → a single emoji. */
export function cellGlyph(state: MenchState, cell: number): string {
  const here = occupantsAt(state, cell);
  if (here.length > 0) return COLOR_EMOJI[here[0].color];
  if (isStarCell(cell)) return CELL_STAR;
  return CELL_EMPTY;
}

/** A quadrant row: 13 consecutive track cells starting at a colour's start cell. */
export function renderTrackRow(state: MenchState, color: MenchColor): string {
  const first = startCell(color);
  let row = '';
  for (let i = 0; i < QUADRANT_SIZE; i++) {
    row += cellGlyph(state, (first + i) % TRACK_SIZE);
  }
  return row;
}

/** The five private home cells of one colour, nearest the entry first. */
export function renderHomeRow(state: MenchState, color: MenchColor): string {
  let row = '';
  for (let rel = HOME_FIRST; rel <= HOME_LAST; rel++) {
    const mine = state.tokens.find((t) => t.color === color && t.rel === rel);
    row += mine ? COLOR_EMOJI[color] : '🔲';
  }
  return row;
}

export function tokenName(index: number): string {
  return `مهرهٔ ${faNum(index + 1)}`;
}
