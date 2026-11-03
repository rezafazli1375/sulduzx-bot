// ─── Minesweeper — pure board logic (no Telegram / DB dependencies) ───

export interface MsCell {
  isMine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number;
}

export type MsDifficultyKey = 'easy' | 'medium' | 'hard';

export interface MsDifficulty {
  key: MsDifficultyKey;
  label: string;
  rows: number;
  cols: number;
  mines: number;
  points: number;
}

// هر سطح سختی: تعداد خانه‌ها زیر ۱۰۰ می‌ماند تا محدودیت دکمه‌های تلگرام رعایت شود
export const MS_DIFFICULTIES: MsDifficulty[] = [
  { key: 'easy', label: 'آسان', rows: 7, cols: 6, mines: 8, points: 40 },
  { key: 'medium', label: 'متوسط', rows: 8, cols: 8, mines: 12, points: 70 },
  { key: 'hard', label: 'سخت', rows: 9, cols: 9, mines: 20, points: 110 },
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
      flagged: false,
      adjacent: 0,
    }))
  );
}

/**
 * چیدن مین‌ها با «ایمنی اولین کلیک»:
 * خانهٔ اول و هشت خانهٔ همسایهٔ آن هرگز مین نمی‌شوند (تا حد امکان).
 */
export function placeMsMines(
  board: MsCell[][],
  rows: number,
  cols: number,
  count: number,
  safeR: number,
  safeC: number
): void {
  const far: [number, number][] = [];
  const near: [number, number][] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === safeR && c === safeC) continue;
      const isAdjacent = Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1;
      if (isAdjacent) near.push([r, c]);
      else far.push([r, c]);
    }
  }

  shuffleInPlace(far);
  shuffleInPlace(near);

  const chosen = [...far, ...near].slice(0, Math.min(count, rows * cols - 1));
  for (const [r, c] of chosen) board[r][c].isMine = true;
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
 * «حف» — باز کردن یک خانه:
 * اگر خانه مین باشد فقط همان خانه باز می‌شود؛
 * اگر خانه ۰ باشد کل ناحیهٔ خالی و خانه‌های مرزی آن هم‌زمان باز می‌شوند.
 */
export function revealMsFlood(
  board: MsCell[][],
  rows: number,
  cols: number,
  startR: number,
  startC: number
): { revealed: number; mineHit: boolean } {
  const result = { revealed: 0, mineHit: false };
  const start = board[startR][startC];
  if (!start || start.revealed) return result;

  if (start.isMine) {
    start.revealed = true;
    start.flagged = false;
    result.revealed = 1;
    result.mineHit = true;
    return result;
  }

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
    cell.flagged = false;
    result.revealed++;

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

  return result;
}

/**
 * «باز کردن اطراف» (Chord):
 * وقتی تعداد پرچم‌های یک خانهٔ باز برابر عدد روی آن باشد، خانه‌های باز نشدهٔ اطراف باز می‌شوند.
 */
export function chordMs(
  board: MsCell[][],
  rows: number,
  cols: number,
  targetR: number,
  targetC: number
): { revealed: number; mineHit: boolean } | null {
  const target = board[targetR][targetC];
  if (!target || !target.revealed || target.isMine || target.adjacent === 0) return null;

  let flags = 0;
  for (const [dr, dc] of NEIGHBOURS) {
    const nr = targetR + dr;
    const nc = targetC + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
    if (board[nr][nc].flagged) flags++;
  }

  if (flags !== target.adjacent) return null;

  const result = { revealed: 0, mineHit: false };

  for (const [dr, dc] of NEIGHBOURS) {
    const nr = targetR + dr;
    const nc = targetC + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
    const cell = board[nr][nc];
    if (cell.revealed) continue;
    if (cell.isMine) {
      cell.revealed = true;
      cell.flagged = false;
      result.revealed++;
      result.mineHit = true;
      continue;
    }
    const sub = revealMsFlood(board, rows, cols, nr, nc);
    result.revealed += sub.revealed;
    if (sub.mineHit) result.mineHit = true;
  }

  return result;
}

/** آمار پرچم‌ها: روی مین / روی خانهٔ امن */
export function countMsFlags(
  board: MsCell[][],
  rows: number,
  cols: number
): { onMines: number; onSafe: number; total: number } {
  let onMines = 0;
  let onSafe = 0;
  let total = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      if (!cell.flagged) continue;
      total++;
      if (cell.isMine) onMines++;
      else onSafe++;
    }
  }

  return { onMines, onSafe, total };
}

/** وضعیت کلی صفحه */
export function msBoardState(
  board: MsCell[][],
  rows: number,
  cols: number,
  mineCount: number
): {
  revealedSafe: number;
  totalSafe: number;
  allSafeRevealed: boolean;
  allMinesFound: boolean;
  flags: { onMines: number; onSafe: number; total: number };
} {
  let revealedSafe = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      if (cell.revealed && !cell.isMine) revealedSafe++;
    }
  }

  const totalSafe = rows * cols - mineCount;
  const flags = countMsFlags(board, rows, cols);

  return {
    revealedSafe,
    totalSafe,
    allSafeRevealed: revealedSafe >= totalSafe,
    allMinesFound: flags.onMines >= mineCount && flags.onSafe === 0,
    flags,
  };
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
