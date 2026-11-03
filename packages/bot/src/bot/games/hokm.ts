import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { requireGroup, checkGameChannelJoin } from './utils.js';
import {
  Card,
  Suit,
  SUITS,
  SUIT_EMOJI,
  SUIT_NAME_FA,
  TRICK_POINTS_TO_WIN,
  TOTAL_TRICKS,
  cardLabel,
  dealHokmHands,
  sortHand,
  findAceHolder,
  teamOf,
  isTrickComplete,
  canPlayCard,
  determineTrickWinner,
  chooseBotCard,
} from './hokm-logic.js';

// ─── Types ───────────────────────────────────
interface HokmPlayer {
  id: number;
  name: string;
  hand: Card[];
  tricks: number;
  isBot: boolean;
}

interface HokmSession {
  chatId: number;
  messageId: number;
  players: HokmPlayer[];
  currentPlayer: number;
  trumpSuit: Suit | null;
  rulerSeat: number;
  currentTrick: { seat: number; card: Card | null }[];
  status: 'waiting' | 'bidding' | 'playing' | 'finished';
  humanSeat: number;
  teamScores: [number, number];
  lastWinnerSeat: number | null;
  result: { winnerTeam: 0 | 1; kot: boolean; su: boolean } | null;
  busy: boolean;
  createdAt: number;
}

const sessions = new Map<string, HokmSession>();

function sessionKey(chatId: number): string {
  return `hokm:${chatId}`;
}

// ─── Helpers ─────────────────────────────────
function emptyTrick(): { seat: number; card: Card | null }[] {
  return [0, 1, 2, 3].map((seat) => ({ seat, card: null }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Keyboard ────────────────────────────────
function buildHokmKeyboard(session: HokmSession): any {
  if (session.status === 'waiting') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🎮 شروع بازی', 'hokm_start')],
      [Markup.button.callback('❌ لغو', 'hokm_cancel')],
    ]);
  }

  if (session.status === 'bidding') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('❤️ حکم دل', 'hokm_trump_hearts'),
        Markup.button.callback('♦️ حکم خشت', 'hokm_trump_diamonds'),
      ],
      [
        Markup.button.callback('♣️ حکم خاج', 'hokm_trump_clubs'),
        Markup.button.callback('♠️ حکم پیک', 'hokm_trump_spades'),
      ],
      [Markup.button.callback('❌ لغو', 'hokm_cancel')],
    ]);
  }

  if (session.status === 'finished') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🔄 بازی جدید', 'hokm_new')],
      [Markup.button.callback('🎙 منوی بازی', 'games')],
    ]);
  }

  const keyboard: any[][] = [];
  const human = session.players[session.humanSeat];

  if (session.currentPlayer === session.humanSeat) {
    const playable = human.hand.filter((card) =>
      canPlayCard(card, human.hand, session.currentTrick, session.trumpSuit)
    );

    if (playable.length === 0) {
      keyboard.push([Markup.button.callback('❌ کارت قانونی ندارید', 'hokm_wait')]);
    } else {
      const cardButtons = playable.map((card) =>
        Markup.button.callback(cardLabel(card), `hokm_play_${card.suit}_${card.rank}`)
      );
      for (let i = 0; i < cardButtons.length; i += 4) {
        keyboard.push(cardButtons.slice(i, i + 4));
      }
    }
  } else {
    keyboard.push([Markup.button.callback('⏳ نوبت بازیکن دیگر است', 'hokm_wait')]);
  }

  keyboard.push([Markup.button.callback('❌ لغو بازی', 'hokm_cancel')]);
  return Markup.inlineKeyboard(keyboard);
}

// ─── Message text ────────────────────────────
function buildHokmText(session: HokmSession): string {
  const lines: string[] = [];
  lines.push('🃏 *بازی حکم*');
  lines.push('');

  if (session.status === 'waiting') {
    lines.push('👥 *۴ بازیکن، ۲ تیم:*');
    lines.push('• تیم شما: شما + بازیکن ۳');
    lines.push('• تیم مقابل: بازیکن ۲ + بازیکن ۴');
    lines.push('');
    lines.push('📋 *قوانین استاندارد حکم:*');
    lines.push('• ۵۲ کارت؛ هر نفر ۱۳ کارت (پخش ۵-۴-۴)');
    lines.push('• یک خال به‌عنوان «حکم» انتخاب می‌شود؛ دارندهٔ اَس حکم، **حاکم** می‌شود و اول بازی می‌کند');
    lines.push('• باید خال خواسته‌شده را بازی کنید؛ اگر نداشتید، هر کارتی (حتی حکم) مجاز است');
    lines.push('• حکم بر همهٔ خال‌ها می‌زند؛ برندهٔ هر تریک، تریک بعدی را شروع می‌کند');
    lines.push(`• تیمی که ${TRICK_POINTS_TO_WIN} تریک بگیرد برندهٔ بازی است`);
    lines.push('• کوت: تیمی که هیچ تریکی نگیرد، دو برابر باخته');
    lines.push('');
    lines.push('🎯 برای شروع، دکمهٔ «شروع بازی» را بزنید.');
    return lines.join('\n');
  }

  const human = session.players[session.humanSeat];

  if (session.status === 'bidding') {
    lines.push('🎯 *خال حکم را انتخاب کنید:*');
    lines.push('');
    lines.push(`🂠 *دست شما (${human.hand.length} کارت):*`);
    lines.push(sortHand(human.hand).map((c) => cardLabel(c)).join(' '));
    lines.push('');
    lines.push('📌 دارندهٔ اَس خال انتخابی، «حاکم» می‌شود و بازی را شروع می‌کند.');
    return lines.join('\n');
  }

  if (session.status === 'finished' && session.result) {
    const humanTeam = teamOf(session.humanSeat);
    const humanWon = session.result.winnerTeam === humanTeam;
    lines.push('🏆 *بازی تمام شد!*');
    lines.push('');
    lines.push(`📊 *نتیجه:* تیم شما ${session.teamScores[humanTeam]} | تیم مقابل ${session.teamScores[humanTeam === 0 ? 1 : 0]}`);
    lines.push('');
    lines.push(humanWon ? '🎉 *تیم شما برنده شد!*' : '😔 *تیم شما باخت!*');
    if (session.result.kot) {
      lines.push('🃏 *کوت!* تیم مقابل هیچ تریکی نگرفت — دو برابر باخت.');
    }
    if (session.result.su) {
      lines.push('🎊 *سو!* یک بازیکن تمام ۱۳ تریک را گرفت.');
    }
    if (humanWon) {
      const points = session.result.kot ? 120 : session.result.su ? 100 : 60;
      lines.push(`⭐️ ${points} امتیاز دریافت شد!`);
    }
    lines.push('');
    lines.push('🂠 *تریک هر بازیکن:*');
    for (const player of session.players) {
      lines.push(`• ${player.name}: ${player.tricks} تریک`);
    }
    return lines.join('\n');
  }

  // ── در حال بازی ──
  const myTeam = teamOf(session.humanSeat);
  const otherTeam = myTeam === 0 ? 1 : 0;

  lines.push(`🎯 *حکم:* ${session.trumpSuit ? SUIT_EMOJI[session.trumpSuit] + ' ' + SUIT_NAME_FA[session.trumpSuit] : '—'}`);
  lines.push(`👑 *حاکم:* ${session.players[session.rulerSeat].name}`);
  lines.push(`📊 *تریک‌ها:* تیم شما ${session.teamScores[myTeam]} | تیم مقابل ${session.teamScores[otherTeam]}`);
  lines.push('');
  lines.push(`🂠 *دست شما (${human.hand.length} کارت):*`);
  lines.push(sortHand(human.hand).map((c) => cardLabel(c)).join(' ') || '—');
  lines.push('');
  lines.push('🎴 *تریک جاری:*');
  for (let seat = 0; seat < 4; seat++) {
    const played = session.currentTrick[seat]?.card;
    lines.push(`• ${session.players[seat].name}: ${played ? cardLabel(played) : '—'}`);
  }
  lines.push('');
  lines.push(`👤 *نوبت:* ${session.players[session.currentPlayer].name}`);
  if (session.currentPlayer === session.humanSeat) {
    const played = session.currentTrick.find((t) => t.card !== null)?.card;
    if (played) {
      lines.push(`⚠️ باید ${SUIT_NAME_FA[played.suit]} بازی کنید (خال خواسته‌شده).`);
    } else {
      lines.push('🃏 کارت دلخواه را بازی کنید.');
    }
  }

  return lines.join('\n');
}

// ─── Start Hokm ──────────────────────────────
export async function handleHokm(ctx: Context) {
  if (!(await requireGroup(ctx, 'حکم'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < 1800000) {
    await ctx.reply('⏳ یک بازی حکم در حال انجام است. لطفاً صبر کنید تا تمام شود.');
    return;
  }

  const fromUser = ctx.from!;
  const session: HokmSession = {
    chatId,
    messageId: 0,
    players: [
      { id: fromUser.id, name: 'شما', hand: [], tricks: 0, isBot: false },
      { id: -1, name: 'بازیکن ۲', hand: [], tricks: 0, isBot: true },
      { id: -2, name: 'بازیکن ۳', hand: [], tricks: 0, isBot: true },
      { id: -3, name: 'بازیکن ۴', hand: [], tricks: 0, isBot: true },
    ],
    currentPlayer: 0,
    trumpSuit: null,
    rulerSeat: 0,
    currentTrick: emptyTrick(),
    status: 'waiting',
    humanSeat: 0,
    teamScores: [0, 0],
    lastWinnerSeat: null,
    result: null,
    busy: false,
    createdAt: Date.now(),
  };
  sessions.set(key, session);

  const msg = await ctx.reply(buildHokmText(session), {
    parse_mode: 'Markdown',
    ...buildHokmKeyboard(session),
  });

  session.messageId = msg.message_id;
}

// ─── Action Handler ──────────────────────────
export async function handleHokmAction(ctx: Context) {
  const action = (ctx.callbackQuery as any).data as string;
  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);
  const session = sessions.get(key);

  if (!session) {
    await ctx.answerCbQuery('⏰ بازی منقضی شده یا وجود ندارد.');
    return;
  }

  const userId = ctx.from!.id;

  if (action === 'hokm_cancel') {
    if (userId !== session.players[session.humanSeat].id) {
      await ctx.answerCbQuery('❌ فقط بازیکن اصلی می‌تواند لغو کند.');
      return;
    }
    sessions.delete(key);
    await ctx.answerCbQuery('بازی لغو شد.');
    try {
      await ctx.editMessageText('❌ بازی حکم لغو شد.');
    } catch {}
    return;
  }

  if (action === 'hokm_new') {
    session.players.forEach((p) => {
      p.hand = [];
      p.tricks = 0;
    });
    session.trumpSuit = null;
    session.rulerSeat = 0;
    session.currentPlayer = 0;
    session.currentTrick = emptyTrick();
    session.teamScores = [0, 0];
    session.lastWinnerSeat = null;
    session.result = null;
    session.busy = false;
    session.status = 'waiting';

    await ctx.answerCbQuery('🔄 بازی جدید آماده شد!');
    await updateHokmMessage(ctx, session);
    return;
  }

  if (action === 'hokm_wait') {
    await ctx.answerCbQuery('⏳ لطفاً صبر کنید...');
    return;
  }

  if (action === 'hokm_start') {
    if (session.status !== 'waiting') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (userId !== session.players[session.humanSeat].id) {
      await ctx.answerCbQuery('❌ فقط بازیکن اصلی می‌تواند شروع کند.');
      return;
    }

    const hands = dealHokmHands();
    for (let seat = 0; seat < 4; seat++) {
      session.players[seat].hand = hands[seat];
      session.players[seat].tricks = 0;
    }

    session.status = 'bidding';
    session.currentTrick = emptyTrick();

    await ctx.answerCbQuery('🎴 کارت‌ها پخش شد! خال حکم را انتخاب کنید.');
    await updateHokmMessage(ctx, session);
    return;
  }

  if (action.startsWith('hokm_trump_')) {
    if (session.status !== 'bidding') {
      await ctx.answerCbQuery('بازی قبلاً شروع شده!');
      return;
    }
    if (userId !== session.players[session.humanSeat].id) {
      await ctx.answerCbQuery('❌ فقط شما می‌توانید حکم انتخاب کنید.');
      return;
    }

    const suit = action.replace('hokm_trump_', '') as Suit;
    session.trumpSuit = suit;

    // دارندهٔ اَس حکم، حاکم می‌شود و بازی را شروع می‌کند
    const aceSeat = findAceHolder(session.players.map((p) => p.hand), suit);
    session.rulerSeat = aceSeat;
    session.currentPlayer = aceSeat;
    session.currentTrick = emptyTrick();
    session.status = 'playing';

    const ruler = session.players[aceSeat];
    await ctx.answerCbQuery(`🎯 حکم: ${SUIT_EMOJI[suit]} — حاکم: ${ruler.name}`);
    await updateHokmMessage(ctx, session);

    if (ruler.isBot) {
      await playBotTurns(ctx, session);
    }
    return;
  }

  if (action.startsWith('hokm_play_')) {
    if (session.status !== 'playing') {
      await ctx.answerCbQuery('⏳ بازی هنوز شروع نشده!');
      return;
    }

    const humanSeat = session.humanSeat;
    if (session.currentPlayer !== humanSeat) {
      await ctx.answerCbQuery('⏳ نوبت شما نیست!');
      return;
    }
    if (userId !== session.players[humanSeat].id) {
      await ctx.answerCbQuery('❌ نوبت شما نیست!');
      return;
    }

    const [, , suitStr, rankStr] = action.split('_');
    const suit = suitStr as Suit;
    const rank = parseInt(rankStr, 10);

    const human = session.players[humanSeat];
    const card = human.hand.find((c) => c.suit === suit && c.rank === rank);
    if (!card) {
      await ctx.answerCbQuery('❌ این کارت در دست شما نیست.');
      return;
    }

    if (!canPlayCard(card, human.hand, session.currentTrick, session.trumpSuit)) {
      const led = session.currentTrick.find((t) => t.card !== null)?.card;
      await ctx.answerCbQuery(
        led ? `❌ باید ${SUIT_NAME_FA[led.suit]} بازی کنید.` : '❌ این کارت قابل بازی نیست.'
      );
      return;
    }

    human.hand = human.hand.filter((c) => !(c.suit === card.suit && c.rank === card.rank));
    session.currentTrick[humanSeat].card = card;

    await ctx.answerCbQuery(`🃏 ${cardLabel(card)} بازی شد`);
    await continueAfterCard(ctx, session);
    return;
  }
}

// ─── Game flow ───────────────────────────────
async function continueAfterCard(ctx: Context, session: HokmSession) {
  if (isTrickComplete(session.currentTrick)) {
    await completeTrick(ctx, session);
  } else {
    session.currentPlayer = (session.currentPlayer + 1) % 4;
    await updateHokmMessage(ctx, session);
  }

  if (session.status === 'playing' && session.players[session.currentPlayer].isBot) {
    await playBotTurns(ctx, session);
  }
}

async function playBotTurns(ctx: Context, session: HokmSession) {
  while (
    session.status === 'playing' &&
    !session.busy &&
    session.players[session.currentPlayer].isBot
  ) {
    session.busy = true;
    try {
      const seat = session.currentPlayer;
      const bot = session.players[seat];
      const card = chooseBotCard(bot.hand, session.currentTrick, session.trumpSuit!, seat);

      bot.hand = bot.hand.filter((c) => !(c.suit === card.suit && c.rank === card.rank));
      session.currentTrick[seat].card = card;

      if (isTrickComplete(session.currentTrick)) {
        await completeTrick(ctx, session);
      } else {
        session.currentPlayer = (session.currentPlayer + 1) % 4;
        await updateHokmMessage(ctx, session);
      }

      await sleep(900);
    } finally {
      session.busy = false;
    }
  }
}

async function completeTrick(ctx: Context, session: HokmSession) {
  const winnerSeat = determineTrickWinner(session.currentTrick, session.trumpSuit!);
  const winner = session.players[winnerSeat];
  const team = teamOf(winnerSeat);

  winner.tricks++;
  session.teamScores[team]++;
  session.lastWinnerSeat = winnerSeat;

  if (session.teamScores[team] >= TRICK_POINTS_TO_WIN) {
    const losingTeam = team === 0 ? 1 : 0;
    const su = winner.tricks >= TOTAL_TRICKS;
    const kot = session.teamScores[losingTeam] === 0;

    session.status = 'finished';
    session.result = { winnerTeam: team, kot, su };

    await awardHokmPoints(ctx, session);
    await updateHokmMessage(ctx, session);
    return;
  }

  session.currentTrick = emptyTrick();
  session.currentPlayer = winnerSeat;

  await updateHokmMessage(ctx, session);
}

async function awardHokmPoints(ctx: Context, session: HokmSession) {
  if (!session.result) return;

  const humanSeat = session.humanSeat;
  const humanTeam = teamOf(humanSeat);
  if (session.result.winnerTeam !== humanTeam) return;

  const points = session.result.kot ? 120 : session.result.su ? 100 : 60;

  try {
    const user = await prisma.user.findFirst({
      where: { telegramId: BigInt(session.players[humanSeat].id), botId: (ctx as any).botId },
    });
    if (!user) return;

    await prisma.user.update({
      where: { id: user.id },
      data: { points: { increment: points } },
    });
    await prisma.pointTransaction.create({
      data: {
        userId: user.id,
        amount: points,
        type: 'BONUS',
        description: 'بازی حکم — برنده',
      },
    });
  } catch {}
}

async function updateHokmMessage(ctx: Context, session: HokmSession) {
  try {
    await ctx.editMessageText(buildHokmText(session), {
      parse_mode: 'Markdown',
      ...buildHokmKeyboard(session),
    });
  } catch {}
}

// Cleanup expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > 3600000) {
      sessions.delete(key);
    }
  }
}, 60000);
