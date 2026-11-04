// ─── Minesweeper — pure board logic (no Telegram / DB dependencies) ───
//
// The rule set is the one Iranian Telegram players know (documented for
// @minroobot, for the competitive variant MineSeeker, and mirrored by the
// open-source TaymazKH/minesweeper-bot):
//
//  • Players alternate taps on one shared board.
//  • Tapping a MINE is the goal: the cell is marked with the tapper's colour,
//    the tapper scores +1 and keeps the turn (a bonus tap).
//  • Tapping a SAFE cell opens it with its adjacent-mine number (a 0 opens the
//    whole empty region) and the turn passes to the next player.
//  • Nobody loses lives. The winner is whoever marked the most mines.

export type MsColour = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'brown';

export const MS_COLORS: MsColour[] = ['red', 'blue', 'green', 'yellow', 'purple', 'brown'];

/** نقطهٔ رنگی بازیکن (برای نوبت و فهرست امتیاز) */
export const MS_EMOJI: Record<MsColour, string> = {
  red: '🔴',
  blue: '🔵',
  green: '🟢',
  yellow: '🟡',
  purple: '🟣',
  brown: '🟤',
};

/** مربع رنگی که روی خانهٔ مین نشسته (علامت «این مین مال من است») */
export const MS_MARK: Record<MsColour, string> = {
  red: '🟥',
  blue: '🟦',
  green: '🟩',
  yellow: '🟨',
  purple: '🟪',
  brown: '🟫',
};

export const MS_NAME_FA: Record<MsColour, string> = {
  red: 'قرمز',
  blue: 'آبی',
  green: 'سبز',
  yellow: 'زرد',
  purple: 'بنفش',
  brown: 'قهوه‌ای',
};

export const MIN_MS_PLAYERS = 2;
export const MAX_MS_PLAYERS = 6;

export function colourForSeat(seat: number): MsColour {
  return MS_COLORS[seat % MS_COLORS.length];
}

export interface MsCell {
  isMine: boolean;
  revealed: boolean;
  /** صندلیِ بازیکنی که این خانه را باز/پیدا کرده (null = هنوز باز نشده) */
  foundBy: number | null;
  adjacent: number;
}

export type MsDifficultyKey = 'easy' | 'medium' | 'hard';

export interface MsDifficulty {
  key: MsDifficultyKey;
  label: string;
  rows: number;
  cols: number;
  mines: number;
  /** جایزهٔ برنده */
  bonus: number;
}

// تعداد خانه‌ها زیر ۱۰۰ می‌ماند تا محدودیت دکمه‌های تلگرام رعایت شود.
// تعداد مین‌ها فرد است تا در بازی دو نفره صفحه نصف‌نصف نشود.
export const MS_DIFFICULTIES: MsDifficulty[] = [
  { key: 'easy', label: 'آسان', rows: 7, cols: 6, mines: 9, bonus: 30 },
  { key: 'medium', label: 'متوسط', rows: 8, cols: 8, mines: 15, bonus: 45 },
  { key: 'hard', label: 'سخت', rows: 9, cols: 9, mines: 21, bonus: 60 },
];

export function getMsDifficulty(key: MsDifficultyKey): MsDifficulty {
  return MS_DIFFICULTIES.find((d) => d.key === key) ?? MS_DIFFICULTIES[0];
}

const NEIGHBOURS: [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export function createMsBoard(rows: number, cols: number): MsCell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      isMine: false,
      revealed: false,
      foundBy: null,
      adjacent: 0,
    }))
  );
}

/**
 * چیدن مین‌ها. برخلاف مین‌روب کلاسیک، اولین کلیک نیازی به ایمنی ندارد؛
 * چون در این قانون زدن روی مین جایزه دارد، نه جریمه.
 */
export function placeMsMines(board: MsCell[][], rows: number, cols: number, count: number): void {
  const cells: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push([r, c]);
  }
  shuffleInPlace(cells);
  for (const [r, c] of cells.slice(0, Math.min(count, cells.length))) {
    board[r][c].isMine = true;
  }
}

/** شمارش مین‌های مجاور هر خانه */
export function computeMsAdjacent(board: MsCell[][], rows: number, cols: number): void {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c].isMine) {
        board[r][c].adjacent = 0;
        continue;
      }
      let count = 0;
      for (const [dr, dc] of NEIGHBOURS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (board[nr][nc].isMine) count++;
      }
      board[r][c].adjacent = count;
    }
  }
}

/**
 * باز کردن یک خانهٔ امن و ناحیهٔ خالیِ اطرافش (flood-fill).
 * خانه‌های باز‌شده به نام `seat` ثبت می‌شوند (برای مساوی‌شکنی).
 * تعداد خانه‌های باز‌شده برگردانده می‌شود.
 */
export function revealMsFlood(
  board: MsCell[][],
  rows: number,
  cols: number,
  startR: number,
  startC: number,
  seat: number
): number {
  const start = board[startR][startC];
  if (!start || start.revealed || start.isMine) return 0;

  let opened = 0;
  const queue: [number, number][] = [[startR, startC]];
  const seen = new Set<number>();

  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    const key = r * cols + c;
    if (seen.has(key)) continue;
    seen.add(key);

    const cell = board[r][c];
    if (!cell || cell.revealed || cell.isMine) continue;

    cell.revealed = true;
    cell.foundBy = seat;
    opened++;

    if (cell.adjacent === 0) {
      for (const [dr, dc] of NEIGHBOURS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const next = board[nr][nc];
        if (next.revealed || next.isMine) continue;
        queue.push([nr, nc]);
      }
    }
  }

  return opened;
}

export type MsTap =
  | { kind: 'invalid'; reason: 'out-of-range' | 'already-open' }
  | { kind: 'mine'; seat: number }
  | { kind: 'safe'; opened: number };

/**
 * یک ضربه روی خانهٔ بسته:
 * مین → با رنگِ زننده علامت می‌خورد (نوبت حفظ می‌شود).
 * امن → خانه و ناحیهٔ خالیِ اطرافش باز می‌شود (نوبت منتقل می‌شود).
 */
export function tapMsCell(
  board: MsCell[][],
  rows: number,
  cols: number,
  r: number,
  c: number,
  seat: number
): MsTap {
  if (Number.isNaN(r) || Number.isNaN(c) || r < 0 || r >= rows || c < 0 || c >= cols) {
    return { kind: 'invalid', reason: 'out-of-range' };
  }
  const cell = board[r][c];
  if (!cell) return { kind: 'invalid', reason: 'out-of-range' };
  if (cell.revealed) return { kind: 'invalid', reason: 'already-open' };

  if (cell.isMine) {
    cell.revealed = true;
    cell.foundBy = seat;
    return { kind: 'mine', seat };
  }

  return { kind: 'safe', opened: revealMsFlood(board, rows, cols, r, c, seat) };
}

/**
 * «باز کردن اطراف» با ضربه روی خانهٔ عدددارِ باز:
 * وقتی همهٔ مین‌های اطراف این خانه پیدا (علامت) خورده باشند، بقیهٔ خانه‌های
 * بستهٔ اطراف با یک ضربه باز می‌شوند — چون قطعاً امن‌اند.
 * خودِ این ضربه مین جدیدی نمی‌دهد، پس نوبت منتقل می‌شود.
 */
export function openAroundFound(
  board: MsCell[][],
  rows: number,
  cols: number,
  targetR: number,
  targetC: number,
  seat: number
): { opened: number } | null {
  const target = board[targetR][targetC];
  if (!target || !target.revealed || target.isMine || target.adjacent === 0) return null;

  let marked = 0;
  const hidden: [number, number][] = [];
  for (const [dr, dc] of NEIGHBOURS) {
    const nr = targetR + dr;
    const nc = targetC + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
    const cell = board[nr][nc];
    if (cell.isMine && cell.foundBy !== null) marked++;
    else if (!cell.revealed) hidden.push([nr, nc]);
  }

  if (marked !== target.adjacent) return null;

  let opened = 0;
  for (const [r, c] of hidden) opened += revealMsFlood(board, rows, cols, r, c, seat);
  return { opened };
}

export interface MsBoardState {
  revealedSafe: number;
  totalSafe: number;
  minesFound: number;
  mineCount: number;
  minesLeft: number;
  allMinesFound: boolean;
  hiddenLeft: number;
}

export function msBoardState(
  board: MsCell[][],
  rows: number,
  cols: number,
  mineCount: number
): MsBoardState {
  let revealedSafe = 0;
  let minesFound = 0;
  let hiddenLeft = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      if (!cell.revealed) hiddenLeft++;
      else if (cell.isMine) minesFound++;
      else revealedSafe++;
    }
  }

  const totalSafe = rows * cols - mineCount;

  return {
    revealedSafe,
    totalSafe,
    minesFound,
    mineCount,
    minesLeft: Math.max(0, mineCount - minesFound),
    allMinesFound: minesFound >= mineCount,
    hiddenLeft,
  };
}

/** چند مینِ این صندلی روی تخته علامت خورده است */
export function minesFoundBySeat(board: MsCell[][], seat: number): number {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell.isMine && cell.foundBy === seat) count++;
    }
  }
  return count;
}

/** خانه‌های امنی که این صندلی باز کرده (برای مساوی‌شکنی) */
export function safeOpenedBySeat(board: MsCell[][], seat: number): number {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (!cell.isMine && cell.revealed && cell.foundBy === seat) count++;
    }
  }
  return count;
}

/** در پایان بازی، مین‌های پیدا‌نشده هم نمایش داده می‌شوند */
export function revealUnfoundMines(board: MsCell[][]): void {
  for (const row of board) {
    for (const cell of row) {
      if (cell.isMine && !cell.revealed) cell.revealed = true;
    }
  }
}

export interface MsStanding {
  seat: number;
  mines: number;
  opened: number;
}

/**
 * رتبه‌بندی: اول بیشترین مین، بعد بیشترین خانهٔ امنِ باز.
 * `draw` یعنی دو نفر اول در هر دو معیار مساوی‌اند.
 */
export function rankMsStandings(standings: MsStanding[]): { ordered: MsStanding[]; draw: boolean } {
  const ordered = standings.slice().sort((a, b) => {
    if (b.mines !== a.mines) return b.mines - a.mines;
    if (b.opened !== a.opened) return b.opened - a.opened;
    return a.seat - b.seat;
  });

  if (ordered.length < 2) return { ordered, draw: false };

  const top = ordered[0];
  const next = ordered[1];
  const draw = top.mines === next.mines && top.opened === next.opened;

  return { ordered, draw };
}

export const MS_CELL_HIDDEN = '⬜';
export const MS_CELL_EMPTY = '·';
export const MS_CELL_MINE = '💣';

/** برچسب یک خانه برای نمایش روی تخته */
export function msCellLabel(cell: MsCell): string {
  if (!cell.revealed) return MS_CELL_HIDDEN;
  if (cell.isMine) {
    if (cell.foundBy === null) return MS_CELL_MINE;
    return MS_MARK[colourForSeat(cell.foundBy)];
  }
  if (cell.adjacent === 0) return MS_CELL_EMPTY;
  return String(cell.adjacent);
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
