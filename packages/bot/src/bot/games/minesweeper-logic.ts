// ─── Minesweeper — pure board logic (no Telegram / DB dependencies) ───
//
// The rule set is the one Iranian Telegram players know (documented for
// @minroobot, for the competitive variant MineSeeker, and mirrored by the
// open-source TaymazKH/minesweeper-bot), trimmed to a two-player duel:
//
//  • Two players alternate taps on one shared board (🔴 red vs 🔵 blue).
//  • Tapping a MINE is the goal: the cell is marked with the tapper's colour,
//    the tapper scores +1 and keeps the turn (a bonus tap).
//  • Tapping a SAFE cell opens it with its adjacent-mine number (a 0 opens the
//    whole empty region) and the turn passes to the other player.
//  • Nobody loses lives. The winner is whoever marked the most mines.
//  • One board only — the hard 9×9 / 21-mine field. The easy and medium
//    boards were dropped on the owner's request.

export type MsColour = 'red' | 'blue';

export const MS_COLORS: MsColour[] = ['red', 'blue'];

/** نقطهٔ رنگی بازیکن (برای نوبت و فهرست امتیاز) */
export const MS_EMOJI: Record<MsColour, string> = {
  red: '🔴',
  blue: '🔵',
};

/**
 * علامت روی خانهٔ مین: همان نقطهٔ رنگیِ بازیکن (نه مربعِ رنگی).
 * از MS_EMOJI مشتق می‌شود تا رنگِ نوبت و رنگِ علامت هیچ‌وقت از هم جدا نشوند.
 */
export const MS_MARK: Record<MsColour, string> = { ...MS_EMOJI };

export const MS_NAME_FA: Record<MsColour, string> = {
  red: 'قرمز',
  blue: 'آبی',
};

/** بازی یک duel دو نفره است: دو صندلی، نه بیشتر */
export const MIN_MS_PLAYERS = 2;
export const MAX_MS_PLAYERS = 2;

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

export type MsDifficultyKey = 'hard';

export interface MsDifficulty {
  key: MsDifficultyKey;
  label: string;
  rows: number;
  cols: number;
  mines: number;
  /** جایزهٔ برنده */
  bonus: number;
}

// تنها یک تخته: ۹×۹ با ۲۱ مین. آسان و متوسط طبق خواستهٔ مالک حذف شدند.
// تعداد خانه‌ها زیر ۱۰۰ می‌ماند تا محدودیت دکمه‌های تلگرام رعایت شود، و
// تعداد مین‌ها فرد است تا در دوئل دو نفره صفحه نصف‌نصف نشود.
export const MS_DIFFICULTIES: MsDifficulty[] = [
  { key: 'hard', label: 'سخت', rows: 9, cols: 9, mines: 21, bonus: 60 },
];

/** تختهٔ پیش‌فرض و تنها تختهٔ بازی */
export const MS_BOARD: MsDifficulty = MS_DIFFICULTIES[0];

export function getMsDifficulty(key: MsDifficultyKey): MsDifficulty {
  return MS_DIFFICULTIES.find((d) => d.key === key) ?? MS_BOARD;
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

export interface MsNeighbourMines {
  /** همهٔ مین‌های اطراف این خانه — پیدا‌شده و پیدا‌نشده */
  total: number;
  /** آن‌هایی که با رنگ یک بازیکن علامت خورده‌اند */
  found: number;
  /** آن‌هایی که هنوز زیر ◽ پنهان‌اند */
  hidden: number;
}

/**
 * شمارش مین‌های اطراف یک خانه، تفکیک‌شده به «پیدا شده» و «هنوز پنهان».
 * همین پاسخ «عدد این خانه غلط است» را می‌دهد: عدد همهٔ مین‌های اطراف را
 * می‌شمارد، پس تا وقتی مینی پیدا نشده، خانه‌اش ◽ می‌ماند و عدد بزرگ‌تر از
 * مین‌های دیدنی است.
 */
export function msNeighbourMines(
  board: MsCell[][],
  rows: number,
  cols: number,
  r: number,
  c: number
): MsNeighbourMines | null {
  const cell = board[r]?.[c];
  if (!cell || cell.isMine) return null;

  let total = 0;
  let found = 0;
  for (const [dr, dc] of NEIGHBOURS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
    const next = board[nr][nc];
    if (!next.isMine) continue;
    total++;
    if (next.foundBy !== null) found++;
  }

  return { total, found, hidden: total - found };
}

/**
 * خانهٔ عدددارِ «تکمیل‌شده»: باز شده و *همهٔ* مین‌های اطرافش علامت خورده‌اند.
 * روی تخته با رنگ سبز (msCellStyle) نشان داده می‌شود — نه با علامت متن، چون
 * هر علامتِ افزوده عرض خانه را عوض می‌کند و ستون‌ها را می‌شکند — و دو چیز را
 * هم‌زمان می‌گوید:
 *  - عدد این خانه با مین‌های دیدنی‌اش می‌خواند (پس «عدد غلط» نیست)،
 *  - خانه‌های بستهٔ باقی‌ماندهٔ اطرافش قطعاً امن‌اند (همان قانون «باز کردن اطراف»).
 */
export function msCellIsSatisfied(
  board: MsCell[][],
  rows: number,
  cols: number,
  r: number,
  c: number
): boolean {
  const cell = board[r]?.[c];
  if (!cell || !cell.revealed || cell.isMine || cell.adjacent === 0) return false;
  const info = msNeighbourMines(board, rows, cols, r, c);
  return !!info && info.hidden === 0;
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

// ─── گلیف‌های خانه ─────────────────────────────────────────────
//
// قانون بی‌خطرِ این بازی: *همهٔ خانه‌ها باید هم‌عرض باشند*.
// عرض دکمهٔ inline را تلگرام از متنِ خودش می‌گیرد؛ پس «۳» (رقم باریک) یا «·»
// در کنار یک ایموجیِ تمام‌عرض مثل ◽ و 💣، عرضِ آن ردیف را با ردیف‌های دیگر
// فرق می‌دهد و خانه‌ها از ستون خودشان جابه‌جا می‌شوند — آن‌وقت کاربر به عددی
// نگاه می‌کند که «کنارش بمبی نیست»، در حالی که عدد درست است و فقط ستون‌ها
// روی صفحه کج شده‌اند (نمایش msalign.mjs: ۴۴٪ خانه‌ها نصف‌عرض رندر می‌شدند).
// برای همین هر خانه دقیقاً یک گلیفِ ایموجی است: رقم‌ها به شکل keycap.

/** خانهٔ باز‌نشده: مربع کوچک (◽) تا تخته جمع‌وجورتر از ⬜ دربیاید */
export const MS_CELL_HIDDEN = '◽';
export const MS_CELL_MINE = '💣';

/** برچسب خانهٔ عدددار — «0️⃣» هم یعنی «هیچ مینی اطرافم نیست» */
export const MS_NUM_GLYPHS: string[] = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];

/** خانهٔ صفر: دیگر «·» نیست؛ همان keycap صفر، تا عرضش با بقیه یکی بماند */
export const MS_CELL_EMPTY = MS_NUM_GLYPHS[0];

/**
 * ✓ فقط در *متن* قوانین و پیام‌ها می‌آید و هرگز کنار عدد دکمه نمی‌چسبد:
 * «3✓» دو گلیف است و عرض خانه را عوض می‌کند (دقیقاً همان باگ).
 */
export const MS_CELL_DONE = '✓';

/** رنگِ دکمهٔ خانهٔ تکمیل‌شده — جایگزین ✓ روی تخته */
export const MS_DONE_STYLE = 'success' as const;

export type MsCellStyle = 'danger' | 'success' | 'primary' | undefined;

/**
 * رنگ دکمه، تنها کانالی است که عرض خانه را تغییر نمی‌دهد:
 *  - خانهٔ بسته     → بدون رنگ
 *  - مینِ باز‌شده   → danger
 *  - عددِ تکمیل‌شده → success (سبز): «همهٔ مین‌هایش پیدا شده، پس بقیهٔ
 *    خانه‌های بستهٔ اطرافش قطعاً امن‌اند»
 *  - عددِ ناقص     → primary (آبی): «دست‌کم یک مینش هنوز زیر ◽ است»
 */
export function msCellStyle(cell: MsCell, satisfied: boolean): MsCellStyle {
  if (!cell.revealed) return undefined;
  if (cell.isMine) return 'danger';
  if (cell.adjacent === 0) return undefined;
  return satisfied ? MS_DONE_STYLE : 'primary';
}

/**
 * برچسب یک خانه برای نمایش روی تخته — همیشه دقیقاً یک گلیفِ تمام‌عرض.
 * (تکمیل‌شدن خانه به رنگِ دکمه سپرده شده، نه به متن؛ ببین msCellStyle.)
 */
export function msCellLabel(cell: MsCell): string {
  if (!cell.revealed) return MS_CELL_HIDDEN;
  if (cell.isMine) {
    if (cell.foundBy === null) return MS_CELL_MINE;
    return MS_MARK[colourForSeat(cell.foundBy)];
  }
  return MS_NUM_GLYPHS[Math.min(8, Math.max(0, cell.adjacent))];
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
