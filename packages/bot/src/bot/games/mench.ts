import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import {
  COLOR_EMOJI,
  COLOR_NAME_FA,
  COLORS,
  DIE_FACE,
  HOME_FIRST,
  HOME_LAST,
  MAX_SIXES_IN_A_ROW,
  MIN_ROLL_TO_ENTER,
  QUADRANT_SIZE,
  RING_LAST,
  TOKENS_PER_PLAYER,
  applyMove,
  chooseBotMove,
  colorsForSeats,
  createState,
  faNum,
  finishedCount,
  inBaseCount,
  isSafeFor,
  isStarCell,
  legalMoves,
  occupantsAt,
  rollDie,
  startCell,
  tokenName,
  tokensOf,
  type MenchColor,
  type MenchMove,
  type MenchState,
} from './mench-logic.js';
import {
  GAME_CANCEL_PURGE_DELAY_MS,
  GAME_RESULT_PURGE_DELAY_MS,
  checkGameChannelJoin,
  purgeGameMessages,
  requireGroup,
  sendGameRules,
  trackGameMessage,
} from './utils.js';

// ─── Config ──────────────────────────────────
const MIN_SEATS = 2;
const MAX_SEATS = 4;
const WINNER_POINTS = 60;
const PARTICIPATION_POINTS = 10;
const CAPTURE_POINTS = 5;
const BOT_THINK_MS = 850;
const SESSION_TTL = 3 * 60 * 60 * 1000; // a 4-player Ludo game is long

const START_GLYPH: Record<MenchColor, string> = {
  red: '🟥',
  green: '🟩',
  yellow: '🟨',
  blue: '🟦',
};

const RULES_TEXT =
  '🎲 *قوانین منچ*\n\n' +
  `• هر بازیکن ${faNum(TOKENS_PER_PLAYER)} مهره دارد. هرکس زودتر هر ${faNum(TOKENS_PER_PLAYER)} مهره را به مرکز 🏁 برساند، برنده است.\n` +
  `• برای بیرون آوردن مهره از خانه باید ${faNum(MIN_ROLL_TO_ENTER)} بیاوری.\n` +
  `• ${faNum(MIN_ROLL_TO_ENTER)} یعنی یک تاسِ اضافه؛ ولی ${faNum(MAX_SIXES_IN_A_ROW)} بار شش پشت‌سرهم = نوبت را از دست می‌دهی.\n` +
  '• اگر مهره‌ات روی مهرهٔ حریف بایستد، حریف به خانهٔ اول برمی‌گردد و تو ۵ امتیاز اضافه می‌گیری.\n' +
  '• خانهٔ ⭐ برای همه امن است. خانهٔ رنگیِ شروع فقط برای صاحبِ همان رنگ امن است.\n' +
  '• دو مهرهٔ هم‌رنگ نمی‌توانند روی یک خانه بایستند.\n' +
  '• ستون منزل ۵ خانه است و برای وارد شدن به مرکز باید عدد دقیق بیاوری.\n' +
  '• مهره‌ای که وارد ستون منزل شد، دیگر زده نمی‌شود.\n\n' +
  '🏆 *امتیاز:* برنده ۶۰ · بقیه ۱۰ · هر مهرهٔ زده‌شده ۵ امتیاز اضافه';

// ─── Session ─────────────────────────────────
interface MenchSeat {
  id: number | null;
  name: string;
  isBot: boolean;
  color: MenchColor;
  sixes: number;
  captures: number;
}

interface MenchSession {
  chatId: number;
  messageId: number;
  ctx: Context | null;
  seats: MenchSeat[];
  seatCount: number;
  state: MenchState;
  status: 'lobby' | 'playing' | 'finished';
  current: number;
  phase: 'roll' | 'move';
  dice: number | null;
  moves: MenchMove[];
  log: string[];
  winner: number | null;
  busy: boolean;
  signature: string | null;
  createdAt: number;
}

const sessions = new Map<string, MenchSession>();

function sessionKey(chatId: number): string {
  return `mench:${chatId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Text helpers ────────────────────────────
function safeName(name: string): string {
  return String(name || 'بازیکن').replace(/[\*\_\`\[\]\{\}\(\)\#\+\-\=\|\.!\s<>]/g, '').trim() || 'بازیکن';
}

function seatLabel(seat: MenchSeat): string {
  if (seat.isBot) return `🤖 ${seat.name}`;
  return `[${safeName(seat.name)}](tg://user?id=${seat.id})`;
}

function seatShort(seat: MenchSeat): string {
  return `${COLOR_EMOJI[seat.color]} ${seat.isBot ? '🤖' : safeName(seat.name)}`;
}

function isActiveColor(session: MenchSession, color: MenchColor): boolean {
  return session.state.colors.includes(color);
}

// ─── Board rendering ─────────────────────────
function renderTrack(session: MenchSession): string {
  const lines: string[] = [];
  for (const color of COLORS) {
    const active = isActiveColor(session, color);
    const header = active ? COLOR_EMOJI[color] : '⚪';
    let row = '';
    for (let i = 0; i < QUADRANT_SIZE; i++) {
      const cell = (startCell(color) + i) % 52;
      const here = occupantsAt(session.state, cell);
      if (here.length > 0) row += COLOR_EMOJI[here[0].color];
      else if (isStarCell(cell)) row += '⭐';
      else if (i === 0 && active) row += START_GLYPH[color];
      else row += '⬜';
    }
    lines.push(`${header} ${row}`);
  }
  return lines.join('\n');
}

function renderHomeColumns(session: MenchSession): string {
  const lines: string[] = [];
  for (const color of session.state.colors) {
    let row = '';
    for (let rel = HOME_FIRST; rel <= HOME_LAST; rel++) {
      const mine = session.state.tokens.find((t) => t.color === color && t.rel === rel);
      row += mine ? COLOR_EMOJI[color] : '🔲';
    }
    const done = finishedCount(session.state, color);
    lines.push(`${COLOR_EMOJI[color]} ${row} 🏁${done > 0 ? ` ✅${faNum(done)}` : ''}`);
  }
  return lines.join('\n');
}

function renderPlayers(session: MenchSession): string {
  const lines: string[] = [];
  for (let i = 0; i < session.seats.length; i++) {
    const seat = session.seats[i];
    const color = seat.color;
    const onBoard = tokensOf(session.state, color).filter((t) => t.rel >= 0 && t.rel <= RING_LAST).length;
    const base = inBaseCount(session.state, color);
    const goal = finishedCount(session.state, color);
    const parts: string[] = [];
    if (base > 0) parts.push(`🏠 ${faNum(base)}`);
    if (onBoard > 0) parts.push(`🛣 ${faNum(onBoard)}`);
    if (goal > 0) parts.push(`🏁 ${faNum(goal)}`);
    if (seat.captures > 0) parts.push(`⚔️ ${faNum(seat.captures)}`);
    const turnMark = session.status === 'playing' && session.current === i ? ' ⬅️' : '';
    if (session.status === 'lobby') {
      lines.push(
        `${COLOR_EMOJI[color]} ${seat.id === null ? `صندلی ${faNum(i + 1)} — خالی` : `${seatLabel(seat)} 🎲 منچ`}${turnMark}`
      );
    } else {
      lines.push(`${COLOR_EMOJI[color]} ${seatLabel(seat)} · ${parts.join(' · ')}${turnMark}`);
    }
  }
  return lines.join('\n');
}

/** Where a move lands, phrased exactly like the printed board (row / cell). */
function destLabel(move: MenchMove): string {
  if (move.leavesBase) return 'از خانه 🏠';
  if (move.reachesGoal) return 'مرکز 🏁';
  if (move.destCell === null) return 'ستون منزل';
  const row = Math.floor(move.destCell / QUADRANT_SIZE) + 1;
  const col = (move.destCell % QUADRANT_SIZE) + 1;
  return `ردیف ${faNum(row)} خانه ${faNum(col)}`;
}

function describeMove(seat: MenchSeat, move: MenchMove): string {
  if (move.leavesBase) return 'مهره‌ای از خانه بیرون آورد';
  if (move.reachesGoal) return 'یک مهره را به مرکز رساند 🏁';
  if (move.entersHome) return 'وارد ستون منزل شد';
  return `${tokenName(move.tokenIndex)} را به ${destLabel(move)} برد`;
}

function buildText(session: MenchSession): string {
  const header = `🎲 *منچ* — میز ${faNum(session.seatCount)} نفره`;
  const block = [header];

  block.push(`\n🛣 *مسیر* — ۴ ردیف ۱۳ خانه‌ای (ردیف ۱ از بالا)\n${renderTrack(session)}`);
  block.push(`\n🏁 *ستون منزل تا مرکز*\n${renderHomeColumns(session)}`);
  block.push(`\n👥 *بازیکنان*\n${renderPlayers(session)}`);

  if (session.status === 'lobby') {
    const host = session.seats[0];
    block.push(
      `\n⏳ منتظر بازیکن… (حداقل ${faNum(MIN_SEATS)} نفر — صندلی‌های خالی را ربات پر می‌کند)\n` +
        `🎯 میزبان: ${seatLabel(host)}`
    );
  } else if (session.status === 'playing') {
    const seat = session.seats[session.current];
    if (session.phase === 'roll') {
      block.push(`\n🎯 نوبت ${COLOR_EMOJI[seat.color]} ${seatLabel(seat)} — تاس بینداز!`);
    } else {
      const dice = session.dice ?? 0;
      block.push(`\n🎲 تاس: ${DIE_FACE[dice]} ${faNum(dice)} — نوبت ${COLOR_EMOJI[seat.color]} ${seatLabel(seat)}`);
      if (session.moves.length === 0) block.push('❌ با این عدد هیچ حرکتی نداری.');
    }
  } else if (session.status === 'finished') {
    const winner = session.winner !== null ? session.seats[session.winner] : null;
    if (winner) {
      const gained = WINNER_POINTS + winner.captures * CAPTURE_POINTS;
      block.push(
        `\n🏆 *برنده:* ${COLOR_EMOJI[winner.color]} ${seatLabel(winner)}\n` +
          `🎉 ${faNum(gained)} امتیاز (${faNum(WINNER_POINTS)} برد` +
          (winner.captures > 0 ? ` + ${faNum(winner.captures)} زده` : '') +
          ')'
      );
    }
  }

  if (session.log.length > 0) {
    block.push(`\n💬 ${session.log.slice(-3).join('\n💬 ')}`);
  }

  return block.join('\n');
}

// ─── Keyboard ────────────────────────────────
function styleButton(button: any, style?: 'danger' | 'success' | 'primary'): any {
  if (style) button.style = style;
  return button;
}

function moveLabel(seat: MenchSeat, move: MenchMove): string {
  let suffix = '';
  if (move.captured.length > 0) suffix = ` ⚔️${faNum(move.captured.length)}`;
  else if (move.reachesGoal) suffix = ' 🏁';
  else if (move.destCell !== null && isSafeFor(seat.color, move.destCell)) suffix = ' ⭐';

  return `${COLOR_EMOJI[seat.color]} ${tokenName(move.tokenIndex)} → ${destLabel(move)}${suffix}`;
}

function buildKeyboard(session: MenchSession): any {
  const rows: any[] = [];

  if (session.status === 'lobby') {
    const freeSeat = session.seats.findIndex((s) => s.id === null && !s.isBot);
    if (freeSeat >= 0) {
      rows.push([Markup.button.callback(`🪑 نشستن سر میز (صندلی ${faNum(freeSeat + 1)})`, 'mench_join')]);
    }
    rows.push([styleButton(Markup.button.callback('🚀 شروع بازی', 'mench_start'), 'success')]);
    rows.push([
      Markup.button.callback('📖 قوانین', 'mench_rules'),
      Markup.button.callback('🎮 منوی بازی', 'games'),
    ]);
    rows.push([styleButton(Markup.button.callback('❌ لغو میز', 'mench_cancel'), 'danger')]);
    return Markup.inlineKeyboard(rows);
  }

  if (session.status === 'finished') {
    rows.push([Markup.button.callback('🔄 میز جدید', 'mench_new')]);
    rows.push([Markup.button.callback('🎮 منوی بازی', 'games')]);
    return Markup.inlineKeyboard(rows);
  }

  const seat = session.seats[session.current];

  if (session.phase === 'roll') {
    rows.push([
      styleButton(
        Markup.button.callback(`🎲 ${COLOR_EMOJI[seat.color]} تاس انداختن`, 'mench_roll'),
        'success'
      ),
    ]);
  } else {
    if (session.moves.length === 0) {
      rows.push([Markup.button.callback('⏭ رد شدن', 'mench_pass')]);
    } else {
      let row: any[] = [];
      for (const move of session.moves) {
        row.push(styleButton(Markup.button.callback(moveLabel(seat, move), `mench_move_${move.tokenIndex}`), 'primary'));
        if (row.length === 2) {
          rows.push(row);
          row = [];
        }
      }
      if (row.length > 0) rows.push(row);
    }
  }

  rows.push([
    Markup.button.callback('📖 قوانین', 'mench_rules'),
    Markup.button.callback('🎮 منوی بازی', 'games'),
  ]);
  rows.push([styleButton(Markup.button.callback('❌ لغو بازی', 'mench_cancel'), 'danger')]);

  return Markup.inlineKeyboard(rows);
}

// ─── Refresh ─────────────────────────────────
async function refresh(session: MenchSession) {
  const ctx = session.ctx;
  if (!ctx || !session.messageId) return;

  const text = buildText(session);
  const keyboard = buildKeyboard(session);
  const signature = `${text}|${JSON.stringify(keyboard?.reply_markup ?? '')}`;
  if (signature === session.signature) return;
  session.signature = signature;

  try {
    await ctx.telegram.editMessageText(String(session.chatId), session.messageId, undefined, text, {
      parse_mode: 'Markdown',
      ...keyboard,
    });
  } catch {
    // message not modified / message deleted — safe to ignore
  }
}

// ─── Lobby / start ───────────────────────────
function findSeatByUser(session: MenchSession, userId: number): number {
  return session.seats.findIndex((s) => s.id === userId);
}

function createTable(chatId: number, seatCount: number, host: { id: number; name: string }): MenchSession {
  const colors = colorsForSeats(seatCount);
  const seats: MenchSeat[] = colors.map((color, index) => ({
    id: index === 0 ? host.id : null,
    name: index === 0 ? host.name : `بازیکن ${faNum(index + 1)}`,
    isBot: false,
    color,
    sixes: 0,
    captures: 0,
  }));

  return {
    chatId,
    messageId: 0,
    ctx: null,
    seats,
    seatCount,
    state: createState(seatCount),
    status: 'lobby',
    current: 0,
    phase: 'roll',
    dice: null,
    moves: [],
    log: [],
    winner: null,
    busy: false,
    signature: null,
    createdAt: Date.now(),
  };
}

// ─── Turn engine ─────────────────────────────
function currentSeat(session: MenchSession): MenchSeat {
  return session.seats[session.current];
}

async function doRoll(session: MenchSession) {
  const seat = currentSeat(session);
  const dice = rollDie();
  session.dice = dice;

  if (dice === MIN_ROLL_TO_ENTER) seat.sixes += 1;
  else seat.sixes = 0;

  if (seat.sixes >= MAX_SIXES_IN_A_ROW) {
    seat.sixes = 0;
    session.log.push(`${seatShort(seat)} ${faNum(MAX_SIXES_IN_A_ROW)} بار شش آورد و نوبتش را از دست داد`);
    session.dice = dice;
    session.phase = 'roll';
    session.moves = [];
    await advanceTurn(session, false);
    return;
  }

  session.moves = legalMoves(session.state, seat.color, dice);
  session.phase = 'move';
}

async function doMove(session: MenchSession, move: MenchMove) {
  const seat = currentSeat(session);
  const extraTurn = session.dice === MIN_ROLL_TO_ENTER;

  const result = applyMove(session.state, seat.color, move);
  seat.sixes = extraTurn ? seat.sixes : 0;

  if (move.captured.length > 0) {
    seat.captures += move.captured.length;
    for (const victim of move.captured) {
      const victimSeat = session.seats.find((s) => s.color === victim.color);
      if (victimSeat) {
        session.log.push(`${seatShort(seat)} ${tokenName(victim.tokenIndex)} ${seatShort(victimSeat)} را زد و به خانه فرستاد`);
      }
    }
  } else {
    session.log.push(`${seatShort(seat)} ${describeMove(seat, move)}`);
  }

  if (result.finished) {
    await finishGame(session, session.current);
    return;
  }

  await advanceTurn(session, extraTurn);
}

async function doPass(session: MenchSession) {
  const seat = currentSeat(session);
  const extraTurn = session.dice === MIN_ROLL_TO_ENTER;
  session.log.push(`${seatShort(seat)} با تاس ${faNum(session.dice ?? 0)} حرکتی نداشت`);
  await advanceTurn(session, extraTurn);
}

async function advanceTurn(session: MenchSession, extraTurn: boolean) {
  session.dice = null;
  session.moves = [];
  session.phase = 'roll';
  if (session.status !== 'playing') return;
  if (!extraTurn) {
    session.current = (session.current + 1) % session.seats.length;
    currentSeat(session).sixes = 0;
  }
}

async function finishGame(session: MenchSession, winnerSeat: number) {
  session.status = 'finished';
  session.winner = winnerSeat;
  session.dice = null;
  session.moves = [];
  const winner = session.seats[winnerSeat];
  session.log.push(`🏆 ${seatShort(winner)} هر ${faNum(TOKENS_PER_PLAYER)} مهره را به مرکز رساند!`);
  await awardPoints(session);
  // نتیجه مدت کوتاهی روی صفحه می‌ماند، بعد تخته از گروه پاک می‌شود
  void purgeGameMessages(session.ctx?.telegram, sessionKey(session.chatId), GAME_RESULT_PURGE_DELAY_MS);
}

async function playBotSeat(session: MenchSession) {
  await doRoll(session);
  await refresh(session);
  if (session.status !== 'playing') return;

  if (session.phase === 'roll') return; // three sixes: turn already passed

  if (session.moves.length === 0) {
    await sleep(450);
    await doPass(session);
    return;
  }

  const seat = currentSeat(session);
  const move = chooseBotMove(session.state, seat.color, session.dice ?? 1, session.moves);
  if (!move) {
    await doPass(session);
    return;
  }
  await sleep(600);
  await doMove(session, move);
}

async function driveBots(session: MenchSession) {
  if (session.busy) return;
  session.busy = true;
  try {
    let guard = 0;
    while (session.status === 'playing' && currentSeat(session).isBot && guard < 400) {
      guard += 1;
      await sleep(BOT_THINK_MS);
      await playBotSeat(session);
    }
  } finally {
    session.busy = false;
  }
  await refresh(session);
}

// ─── Points ──────────────────────────────────
async function awardPoints(session: MenchSession) {
  const ctx = session.ctx;
  if (!ctx) return;
  const botId = (ctx as any).botId;

  for (let index = 0; index < session.seats.length; index++) {
    const seat = session.seats[index];
    if (seat.isBot || seat.id === null) continue;

    const isWinner = session.winner === index;
    const total = (isWinner ? WINNER_POINTS : PARTICIPATION_POINTS) + seat.captures * CAPTURE_POINTS;
    if (total <= 0) continue;

    try {
      const user = await prisma.user.findFirst({
        where: { telegramId: BigInt(seat.id), botId },
      });
      if (!user) continue;
      await prisma.user.update({
        where: { id: user.id },
        data: { points: { increment: total } },
      });
      await prisma.pointTransaction.create({
        data: {
          userId: user.id,
          amount: total,
          type: 'BONUS',
          description: isWinner ? 'بازی منچ — برنده' : 'بازی منچ — شرکت در بازی',
        },
      });
    } catch {
      // user not registered / db hiccup — never break the game
    }
  }
}

// ─── Entry point ─────────────────────────────
export async function handleMench(ctx: Context) {
  if (!(await requireGroup(ctx, 'منچ'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);
  const existing = sessions.get(key);

  if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < SESSION_TTL) {
    const seatIndex = findSeatByUser(existing, ctx.from!.id);
    if (existing.status === 'lobby' && seatIndex >= 0) {
      await ctx.reply(
        `🎲 یک میز ${faNum(existing.seatCount)} نفره باز است و شما روی صندلی نشسته‌اید.\n` +
          `👉 برای شروع، میزبان دکمهٔ «🚀 شروع بازی» را می‌زند.`
      );
      return;
    }
    if (existing.status === 'lobby') {
      await ctx.reply('🎲 یک میز باز است. از دکمهٔ «🪑 نشستن سر میز» روی همان پیام استفاده کن.');
      return;
    }
    await ctx.reply('🎲 یک بازی منچ در حال انجام است. لطفاً نوبت خود را منتظر بمان.');
    return;
  }

  if (existing) sessions.delete(key);

  const rows = [
    [
      Markup.button.callback('👥 ۲ نفره', 'mench_table_2'),
      Markup.button.callback('👥 ۳ نفره', 'mench_table_3'),
      Markup.button.callback('👥 ۴ نفره', 'mench_table_4'),
    ],
    [Markup.button.callback('📖 قوانین', 'mench_rules'), Markup.button.callback('🎮 منوی بازی', 'games')],
  ];

  await ctx.reply(
    '🎲 *بازی منچ*\n\n' +
      '👥 میزت را انتخاب کن — از ۲ تا ۴ نفر. صندلی‌های خالی را ربات پر می‌کند.\n\n' +
      `🎯 هدف: ${faNum(TOKENS_PER_PLAYER)} مهره را یک دور کامل به دور صفحه ببر و زودتر از همه به مرکز 🏁 برسان.\n` +
      '🛣 صفحه ۵۲ خانه است؛ ⭐ خانهٔ امن است و با ۶ می‌توانی مهره را از خانه بیرون بیاوری.\n\n' +
      `🏆 امتیاز: برنده ${faNum(WINNER_POINTS)} · بقیه ${faNum(PARTICIPATION_POINTS)} · هر مهرهٔ زده‌شده ${faNum(CAPTURE_POINTS)}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
  );
}

// ─── Action handler ──────────────────────────
export async function handleMenchAction(ctx: Context) {
  const action = (ctx.callbackQuery as any).data as string;
  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);
  const userId = ctx.from!.id;
  const userName = ctx.from!.first_name || 'بازیکن';

  if (action === 'mench_rules') {
    // قوانین کامل در پیوی بازیکن؛ اگر نشد، در گروه (و در پایان بازی پاک می‌شود)
    await sendGameRules(ctx, key, RULES_TEXT);
    return;
  }

  if (action.startsWith('mench_table_')) {
    const seatCount = parseInt(action.replace('mench_table_', ''), 10);
    if (!Number.isFinite(seatCount) || seatCount < MIN_SEATS || seatCount > MAX_SEATS) {
      await ctx.answerCbQuery('❌ تعداد بازیکن نامعتبر است.');
      return;
    }
    const existing = sessions.get(key);
    if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < SESSION_TTL) {
      await ctx.answerCbQuery('⚠️ در این گروه یک میز باز یا در حال بازی است.');
      return;
    }
    if (existing) sessions.delete(key);

    const session = createTable(chatId, seatCount, { id: userId, name: userName });
    session.ctx = ctx;
    const message = ctx.callbackQuery && (ctx.callbackQuery as any).message;
    session.messageId = message ? message.message_id : 0;
    sessions.set(key, session);
    // همان پیام «انتخاب میز» به تختهٔ بازی تبدیل می‌شود؛ در دفتر ثبتش کن تا در پایان پاک شود
    if (session.messageId > 0) trackGameMessage(key, chatId, session.messageId, ctx.telegram);

    await ctx.answerCbQuery(`🎲 میز ${faNum(seatCount)} نفره ساخته شد`);
    session.signature = null;
    await refresh(session);
    return;
  }

  const session = sessions.get(key);
  if (!session) {
    await ctx.answerCbQuery('⏰ بازی منچ این گروه تمام شده یا لغو شده است.');
    return;
  }
  session.ctx = ctx;

  if (action === 'mench_join') {
    if (session.status !== 'lobby') {
      await ctx.answerCbQuery('❌ بازی شروع شده است.');
      return;
    }
    if (findSeatByUser(session, userId) >= 0) {
      await ctx.answerCbQuery('✅ شما قبلاً روی صندلی نشسته‌اید.');
      return;
    }
    const free = session.seats.findIndex((s) => s.id === null && !s.isBot);
    if (free < 0) {
      await ctx.answerCbQuery('❌ صندلی خالی نیست.');
      return;
    }
    session.seats[free] = { ...session.seats[free], id: userId, name: userName };
    await ctx.answerCbQuery(`🪑 روی صندلی ${faNum(free + 1)} (${COLOR_NAME_FA[session.seats[free].color]}) نشستی`);
    await refresh(session);
    return;
  }

  if (action === 'mench_start') {
    if (session.status !== 'lobby') {
      await ctx.answerCbQuery('❌ این میز شروع شده است.');
      return;
    }
    if (session.seats[0].id !== userId) {
      await ctx.answerCbQuery('❌ فقط میزبان می‌تواند بازی را شروع کند.');
      return;
    }
    // bots take the empty seats
    let botNumber = 0;
    for (const seat of session.seats) {
      if (seat.id === null) {
        seat.isBot = true;
        botNumber += 1;
        seat.name = `ربات ${faNum(botNumber)}`;
      }
    }
    session.status = 'playing';
    session.current = 0;
    session.phase = 'roll';
    session.log = [`🎬 بازی شروع شد — ${COLOR_EMOJI[session.seats[0].color]} اول بازی می‌کند`];
    await ctx.answerCbQuery('🎲 بازی شروع شد!');
    await refresh(session);
    await driveBots(session);
    return;
  }

  if (action === 'mench_cancel') {
    const seatIndex = findSeatByUser(session, userId);
    const isHost = session.seats[0].id === userId;
    if (session.status === 'playing' && !isHost && seatIndex >= 0) {
      await ctx.answerCbQuery('❌ فقط میزبان می‌تواند بازی را لغو کند.');
      return;
    }
    if (session.status === 'playing' && seatIndex < 0 && !isHost) {
      await ctx.answerCbQuery('❌ شما در این بازی نیستید.');
      return;
    }
    sessions.delete(key);
    void purgeGameMessages(ctx.telegram, key, GAME_CANCEL_PURGE_DELAY_MS);
    await ctx.answerCbQuery('🗑 میز حذف شد');
    try {
      await ctx.telegram.editMessageText(
        String(session.chatId),
        session.messageId,
        undefined,
        '❌ میز منچ لغو شد.'
      );
    } catch {}
    return;
  }

  if (action === 'mench_new') {
    sessions.delete(key);
    void purgeGameMessages(ctx.telegram, key, GAME_CANCEL_PURGE_DELAY_MS);
    await ctx.answerCbQuery();
    await handleMench(ctx);
    return;
  }

  // ─── In-game actions ───────────────────────
  if (session.status !== 'playing') {
    await ctx.answerCbQuery('🏁 بازی تمام شده است!');
    return;
  }

  const seat = currentSeat(session);
  if (seat.id !== userId) {
    await ctx.answerCbQuery(`❌ نوبتِ ${COLOR_NAME_FA[seat.color]} است.`, { show_alert: true });
    return;
  }

  if (action === 'mench_roll') {
    if (session.phase !== 'roll') {
      await ctx.answerCbQuery('❌ اول مهره‌ات را حرکت بده.');
      return;
    }
    await ctx.answerCbQuery();
    await doRoll(session);
    await refresh(session);
    return;
  }

  if (action === 'mench_pass') {
    if (session.phase !== 'move' || session.moves.length > 0) {
      await ctx.answerCbQuery('❌ الان نمی‌توانی رد شوی.');
      return;
    }
    await ctx.answerCbQuery('⏭ رد شدی');
    await doPass(session);
    await refresh(session);
    await driveBots(session);
    return;
  }

  if (action.startsWith('mench_move_')) {
    if (session.phase !== 'move') {
      await ctx.answerCbQuery('❌ اول تاس بینداز.');
      return;
    }
    const tokenIndex = parseInt(action.replace('mench_move_', ''), 10);
    const move = session.moves.find((m) => m.tokenIndex === tokenIndex);
    if (!move) {
      await ctx.answerCbQuery('❌ این حرکت ممکن نیست.');
      return;
    }
    await ctx.answerCbQuery();
    await doMove(session, move);
    await refresh(session);
    await driveBots(session);
    return;
  }
}

// ─── Cleanup ─────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(key);
    }
  }
}, 60000);
