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

// ─── حرکت ربات (بازی در پیوی — نسخهٔ ۲٫۰٫۰) ───────────────
// در گفتگوی خصوصی حریفِ کاربر خودِ ربات است. تابع‌های این بخش *خالص*‌اند
// (دیتابیس و تلگرام نمی‌بینند) تا در هارنس تست قابل سنجش باشند: «ربات برندهٔ
// واگذارشده را می‌گیرد»، «ربات تهدید حریف را مسدود می‌کند» و «در حالت سخت
// باز هم باختنی نیست».

export type TttDifficulty = 'easy' | 'normal' | 'hard';

export type TttCell = [number, number];

export function emptyTttCells(board: TttBoard, rows: number, cols: number): TttCell[] {
  const cells: TttCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === null) cells.push([r, c]);
    }
  }
  return cells;
}

function otherMark(mark: 'X' | 'O'): 'X' | 'O' {
  return mark === 'X' ? 'O' : 'X';
}

/**
 * آیا گذاشتن `mark` روی (r,c) همین حالا خطِ winLength می‌سازد؟
 * برای «ضربهٔ برنده» و «بستن تهدید آنی» استفاده می‌شود.
 */
export function completesLine(
  board: TttBoard,
  rows: number,
  cols: number,
  winLength: number,
  r: number,
  c: number,
  mark: 'X' | 'O'
): boolean {
  if (r < 0 || c < 0 || r >= rows || c >= cols || board[r][c] !== null) return false;

  for (const [dr, dc] of DIRECTIONS) {
    let run = 1;
    for (const sign of [1, -1]) {
      let nr = r + dr * sign;
      let nc = c + dc * sign;
      while (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === mark) {
        run++;
        nr += dr * sign;
        nc += dc * sign;
      }
    }
    if (run >= winLength) return true;
  }
  return false;
}

/** اولین خانه‌ای که `mark` را برنده می‌کند؛ اگر نباشد null */
export function findWinningCell(
  board: TttBoard,
  rows: number,
  cols: number,
  winLength: number,
  mark: 'X' | 'O'
): TttCell | null {
  for (const [r, c] of emptyTttCells(board, rows, cols)) {
    if (completesLine(board, rows, cols, winLength, r, c, mark)) return [r, c];
  }
  return null;
}

/**
 * امتیاز «پتانسیل خط» یک خانه برای یک مهره:
 * هر جهت را دو طرف می‌خواند و طولِ مهره‌های پشت‌سرهم را با سرِ باز وزن می‌کند.
 * بردنِ خودش و بستنِ حریف با همین وزن سنجیده می‌شود، پس روی ۳×۳ و ۶×۷ یکی
 * کار می‌کند (minimax روی ۶×۷ ممکن نیست).
 */
function linePotential(
  board: TttBoard,
  rows: number,
  cols: number,
  winLength: number,
  r: number,
  c: number,
  mark: 'X' | 'O'
): number {
  let total = 0;

  for (const [dr, dc] of DIRECTIONS) {
    let run = 1;
    let openEnds = 0;

    for (const sign of [1, -1]) {
      let nr = r + dr * sign;
      let nc = c + dc * sign;
      while (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === mark) {
        run++;
        nr += dr * sign;
        nc += dc * sign;
      }
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === null) openEnds++;
    }

    if (run >= winLength) {
      total += 100000;
    } else if (run === winLength - 1) {
      total += openEnds === 2 ? 5000 : openEnds === 1 ? 900 : 0;
    } else if (run === winLength - 2) {
      total += openEnds === 2 ? 300 : openEnds === 1 ? 40 : 0;
    } else {
      total += openEnds * run * 2;
    }
  }

  return total;
}

/** مقدارگذاری minimax برای ۳×۳ (حالت کلاسیک) — برنده +، مساوی ۰، بازنده − */
function minimax(
  board: TttBoard,
  rows: number,
  cols: number,
  winLength: number,
  turn: 'X' | 'O',
  bot: 'X' | 'O',
  depth: number,
  alpha: number,
  beta: number
): number {
  const winner = checkTttWinner(board, rows, cols, winLength);
  if (winner) return winner.mark === bot ? 100 - depth : depth - 100;

  const cells = emptyTttCells(board, rows, cols);
  if (cells.length === 0) return 0;

  const maximise = turn === bot;
  let best = maximise ? -Infinity : Infinity;

  for (const [r, c] of cells) {
    board[r][c] = turn;
    const value = minimax(board, rows, cols, winLength, otherMark(turn), bot, depth + 1, alpha, beta);
    board[r][c] = null;

    if (maximise) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }

  return best;
}

/**
 * خانهٔ پیشنهادی ربات.
 *   easy   → تصادفی (ربت عمداً قابل‌باخت است؛ بازی با بچه‌ها)
 *   normal → اول برنده شود، بعد تهدید آنی حریف را ببند، وگرنه تصادفی
 *   hard   → روی ۳×۳ minimax کامل (باختنی نیست)، روی ۶×۷ وزن‌دهی خطی
 * هر سه حالت *همیشه* یک خانهٔ معتبر برمی‌گردانند، مگر اینکه تخته پر باشد.
 */
export function chooseBotMove(
  board: TttBoard,
  rows: number,
  cols: number,
  winLength: number,
  botMark: 'X' | 'O',
  difficulty: TttDifficulty
): TttCell | null {
  const cells = emptyTttCells(board, rows, cols);
  if (cells.length === 0) return null;

  if (difficulty === 'easy') {
    return cells[Math.floor(Math.random() * cells.length)];
  }

  // برندهٔ فوری، حتی در حالت عادی هم از دست نمی‌رود
  const winning = findWinningCell(board, rows, cols, winLength, botMark);
  if (winning) return winning;

  const threat = findWinningCell(board, rows, cols, winLength, otherMark(botMark));

  if (difficulty === 'hard' && rows * cols <= 9) {
    let best: TttCell = cells[0];
    let bestValue = -Infinity;
    for (const [r, c] of cells) {
      board[r][c] = botMark;
      const value = minimax(board, rows, cols, winLength, otherMark(botMark), botMark, 1, -Infinity, Infinity);
      board[r][c] = null;
      if (value > bestValue) {
        bestValue = value;
        best = [r, c];
      }
    }
    return best;
  }

  let best: TttCell = threat ?? cells[0];
  let bestScore = -Infinity;

  for (const [r, c] of cells) {
    const own = linePotential(board, rows, cols, winLength, r, c, botMark);
    const block = threat ? 6000 : linePotential(board, rows, cols, winLength, r, c, otherMark(botMark));
    // مرکز و خانه‌های کناریِ پرجمعیت، امتیازِ خط‌سازیِ بهتری می‌دهند
    const centreBias =
      (rows - Math.abs(2 * r - (rows - 1))) + (cols - Math.abs(2 * c - (cols - 1)));
    const score = own * 1.0 + block * 0.95 + centreBias * (difficulty === 'hard' ? 3 : 1);

    if (score > bestScore) {
      bestScore = score;
      best = [r, c];
    }
  }

  return best;
}

/** سختیِ ذخیره‌شده در پنل → مقدار معتبر؛ هر چیز ناشناخته «normal» است */
export function normalizeTttDifficulty(value?: string | null): TttDifficulty {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'easy' || v === 'normal' || v === 'hard') return v;
  return 'normal';
}
