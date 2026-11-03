// ─── Tic-Tac-Toe — pure board logic ───

export type TttMark = 'X' | 'O' | null;
export type TttBoard = TttMark[][];

export interface TttMode {
  key: string;
  label: string;
  cols: number;
  rows: number;
  winLength: number;
  points: number;
  description: string;
}

// حالت کلاسیک (۳×۳) و حالت حرفه‌ای (۶×۷ با برد پنج‌تایی)
export const TTT_MODES: TttMode[] = [
  {
    key: 'classic',
    label: 'کلاسیک ۳×۳',
    cols: 3,
    rows: 3,
    winLength: 3,
    points: 25,
    description: '۳×۳ — برد با ۳ مهرهٔ پشت سر هم',
  },
  {
    key: 'pro',
    label: 'حرفه‌ای ۶×۷',
    cols: 6,
    rows: 7,
    winLength: 5,
    points: 45,
    description: '۶×۷ — برد با ۵ مهرهٔ پشت سر هم',
  },
];

export function getTttMode(key: string): TttMode {
  return TTT_MODES.find((m) => m.key === key) ?? TTT_MODES[0];
}

export function createTttBoard(rows: number, cols: number): TttBoard {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

const DIRECTIONS: [number, number][] = [
  [0, 1],   // افقی
  [1, 0],   // عمودی
  [1, 1],   // مورب
  [1, -1],  // مورب معکوس
];

/**
 * برنده را پیدا می‌کند و خط برنده را هم برمی‌گرداند.
 * در حالت ۶×۷ هر ۵ مهره (یا بیشتر) پشت سر هم برنده است.
 */
export function checkTttWinner(
  board: TttBoard,
  rows: number,
  cols: number,
  winLength: number
): { mark: 'X' | 'O'; line: [number, number][] } | null {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const mark = board[r][c];
      if (!mark) continue;

      for (const [dr, dc] of DIRECTIONS) {
        const line: [number, number][] = [];
        for (let k = 0; k < winLength; k++) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) break;
          if (board[nr][nc] !== mark) break;
          line.push([nr, nc]);
        }

        if (line.length >= winLength) {
          return { mark, line: line.slice(0, winLength) };
        }
      }
    }
  }

  return null;
}

export function isTttBoardFull(board: TttBoard, rows: number, cols: number): boolean {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === null) return false;
    }
  }
  return true;
}
