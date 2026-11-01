import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { findUserByCtx } from '../../lib/user.js';
import { requireGroup, checkGameChannelJoin } from './utils.js';

// ─── Types ───────────────────────────────────
type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
type Card = { suit: Suit; rank: number; };

interface HokmSession {
  chatId: number;
  messageId: number;
  players: { id: number; name: string; hand: Card[]; tricks: number; isBot: boolean }[];
  currentPlayer: number;
  trumpSuit: Suit | null;
  currentTrick: { playerId: number; card: Card | null }[];
  deck: Card[];
  status: 'waiting' | 'bidding' | 'playing' | 'finished';
  humanPlayerId: number;
  round: number;
  scores: { team1: number; team2: number };
  createdAt: number;
}

const sessions = new Map<string, HokmSession>();

function sessionKey(chatId: number): string {
  return `hokm:${chatId}`;
}

// ─── Card utilities ──────────────────────────
const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const suitEmojis: Record<Suit, string> = {
  hearts: '❤️',
  diamonds: '♦️',
  clubs: '♣️',
  spades: '♠️',
};

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of suits) {
    for (let rank = 2; rank <= 14; rank++) { // 2-10, J=11, Q=12, K=13, A=14
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function dealCards(session: HokmSession) {
  const deck = shuffleDeck(createDeck());
  for (let i = 0; i < 4; i++) {
    session.players[i].hand = deck.slice(i * 13, (i + 1) * 13);
    session.players[i].tricks = 0;
  }
}

function getCardEmoji(card: Card): string {
  const rankStr = card.rank === 14 ? 'A' : card.rank === 13 ? 'K' : card.rank === 12 ? 'Q' : card.rank === 11 ? 'J' : String(card.rank);
  return `${suitEmojis[card.suit]}${rankStr}`;
}

function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => {
    if (a.suit !== b.suit) return suits.indexOf(a.suit) - suits.indexOf(b.suit);
    return a.rank - b.rank;
  });
}

function canPlayCard(card: Card, hand: Card[], currentTrick: { playerId: number; card: Card | null }[], trumpSuit: Suit | null): boolean {
  if (currentTrick.every(t => t.card === null)) return true; // First to play
  
  const firstCard = currentTrick.find(t => t.card !== null)?.card!;
  const hasSuit = hand.some(c => c.suit === firstCard.suit);
  
  if (hasSuit) {
    return card.suit === firstCard.suit;
  }
  return true; // Can play any card if don't have the suit
}

function determineTrickWinner(trick: { playerId: number; card: Card | null }[], trumpSuit: Suit): number {
  const firstCard = trick.find(t => t.card !== null)!.card!;
  let winner = trick[0];
  
  for (const play of trick) {
    if (!play.card) continue;
    if (play.card.suit === trumpSuit && winner.card!.suit !== trumpSuit) {
      winner = play;
    } else if (play.card.suit === winner.card!.suit && play.card.rank > winner.card!.rank) {
      winner = play;
    } else if (play.card.suit === firstCard.suit && winner.card!.suit !== firstCard.suit && play.card.suit !== trumpSuit) {
      winner = play;
    }
  }
  
  return winner.playerId;
}

function buildHokmKeyboard(session: HokmSession): any {
  if (session.status === 'waiting') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🎮 شروع بازی', 'hokm_start')],
      [Markup.button.callback('❌ لغو', 'hokm_cancel')],
    ]);
  }

  if (session.status === 'bidding') {
    const humanPlayer = session.players.find(p => p.id === session.humanPlayerId)!;
    const buttons = [];
    
    // Show hand
    const handStr = sortHand(humanPlayer.hand).map(c => getCardEmoji(c)).join(' ');
    
    // Trump selection buttons
    buttons.push([Markup.button.callback('❤️ حکم دل', 'hokm_trump_hearts')]);
    buttons.push([Markup.button.callback('♦️ حکم خشت', 'hokm_trump_diamonds')]);
    buttons.push([Markup.button.callback('♣️ حکم خاج', 'hokm_trump_clubs')]);
    buttons.push([Markup.button.callback('♠️ حکم پیک', 'hokm_trump_spades')]);
    
    return Markup.inlineKeyboard(buttons);
  }

  if (session.status === 'playing') {
    const humanPlayer = session.players.find(p => p.id === session.humanPlayerId)!;
    const buttons = [];
    
    if (session.currentPlayer === session.players.findIndex(p => p.id === session.humanPlayerId)) {
      // Human's turn - show playable cards
      const playableCards = humanPlayer.hand.filter(c => 
        canPlayCard(c, humanPlayer.hand, session.currentTrick, session.trumpSuit)
      );
      
      const cardButtons = playableCards.map((card, idx) => 
        Markup.button.callback(getCardEmoji(card), `hokm_play_${idx}`)
      );
      
      // Arrange in rows of 4
      for (let i = 0; i < cardButtons.length; i += 4) {
        buttons.push(cardButtons.slice(i, i + 4));
      }
    } else {
      buttons.push([Markup.button.callback('⏳ نوبت بازیکن دیگر...', 'hokm_wait')]);
    }
    
    buttons.push([Markup.button.callback('❌ لغو بازی', 'hokm_cancel')]);
    
    return Markup.inlineKeyboard(buttons);
  }

  if (session.status === 'finished') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🔄 بازی جدید', 'hokm_new')],
      [Markup.button.callback('🔙 منوی بازی', 'games')],
    ]);
  }

  return Markup.inlineKeyboard([]);
}

// ─── Start Hokm ──────────────────────────────
export async function handleHokm(ctx: Context) {
  if (!(await requireGroup(ctx, 'حکم'))) return;
  if (!(await checkGameChannelJoin(ctx))) return;

  const chatId = ctx.chat!.id;
  const key = sessionKey(chatId);

  const existing = sessions.get(key);
  if (existing && existing.status !== 'finished' && Date.now() - existing.createdAt < 1200000) {
    await ctx.reply('⏳ یک بازی حکم در حال انجام است. لطفاً صبر کنید تا تمام شود.');
    return;
  }

  const fromUser = ctx.from!;

  const session: HokmSession = {
    chatId,
    messageId: 0,
    players: [
      { id: fromUser.id, name: fromUser.first_name || 'شما', hand: [], tricks: 0, isBot: false },
      { id: -1, name: 'بازیکن ۲ (Bot)', hand: [], tricks: 0, isBot: true },
      { id: -2, name: 'بازیکن ۳ (Bot)', hand: [], tricks: 0, isBot: true },
      { id: -3, name: 'بازیکن ۴ (Bot)', hand: [], tricks: 0, isBot: true },
    ],
    currentPlayer: 0,
    trumpSuit: null,
    currentTrick: [],
    deck: [],
    status: 'waiting',
    humanPlayerId: fromUser.id,
    round: 1,
    scores: { team1: 0, team2: 0 },
    createdAt: Date.now(),
  };
  sessions.set(key, session);

  const msg = await ctx.reply(
    `🃏 *حکم*\n\n` +
    `🎮 ${mentionUser(fromUser.id, fromUser.first_name || 'بازیکن')} بازی را شروع کرد!\n\n` +
    `👥 *بازیکنان:*\n` +
    `• شما (تیم ۱)\n` +
    `• بازیکن ۲ (Bot - تیم ۱)\n` +
    `• بازیکن ۳ (Bot - تیم ۲)\n` +
    `• بازیکن ۴ (Bot - تیم ۲)\n\n` +
    `📋 *قوانین:*\n` +
    `• بازی ۴ نفره با ۵۲ کارت\n` +
    `• هر نفر ۱۳ کارت\n` +
    `• حکم = خال برنده\n` +
    `• تیم اول: شما + بازیکن ۲\n` +
    `• تیم دوم: بازیکن ۳ + بازیکن ۴\n` +
    `• هر تیم ۷ trick ببرد = برنده\n\n` +
    `🎯 *امتیاز:* ۶۰ برای برد`,
    { parse_mode: 'Markdown', ...buildHokmKeyboard(session) }
  );

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
    if (userId !== session.humanPlayerId) {
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
    sessions.delete(key);
    await ctx.answerCbQuery();
    await handleHokm(ctx);
    return;
  }

  if (action === 'hokm_wait') {
    await ctx.answerCbQuery('⏳ لطفاً صبر کنید...');
    return;
  }

  if (action === 'hokm_start') {
    if (userId !== session.humanPlayerId) {
      await ctx.answerCbQuery('❌ فقط بازیکن اصلی می‌تواند شروع کند.');
      return;
    }
    
    session.status = 'bidding';
    dealCards(session);
    
    await ctx.answerCbQuery('🎮 بازی شروع شد! حکم را انتخاب کنید.');
    await updateHokmMessage(ctx, session);
    return;
  }

  if (action.startsWith('hokm_trump_')) {
    if (userId !== session.humanPlayerId) {
      await ctx.answerCbQuery('❌ فقط شما می‌توانید حکم انتخاب کنید.');
      return;
    }
    
    const suit = action.replace('hokm_trump_', '') as Suit;
    session.trumpSuit = suit;
    session.status = 'playing';
    session.currentPlayer = 0;
    session.currentTrick = Array(4).fill(null).map((_, i) => ({ playerId: i, card: null }));
    
    await ctx.answerCbQuery(`🎯 حکم: ${suitEmojis[suit]}`);
    await updateHokmMessage(ctx, session);
    
    // Play bot turns
    setTimeout(() => playBotsTurns(ctx, session), 1000);
    return;
  }

  if (action.startsWith('hokm_play_')) {
    if (userId !== session.humanPlayerId) {
      await ctx.answerCbQuery('❌ نوبت شما نیست!');
      return;
    }
    
    const cardIdx = parseInt(action.replace('hokm_play_', ''));
    const humanPlayer = session.players.find(p => p.id === session.humanPlayerId)!;
    const card = humanPlayer.hand[cardIdx];
    
    if (!canPlayCard(card, humanPlayer.hand, session.currentTrick, session.trumpSuit)) {
      await ctx.answerCbQuery('❌ نمی‌توانید این کارت را بازی کنید!');
      return;
    }
    
    // Play the card
    const playerIdx = session.players.findIndex(p => p.id === session.humanPlayerId);
    session.currentTrick[playerIdx].card = card;
    humanPlayer.hand.splice(cardIdx, 1);
    
    await ctx.answerCbQuery(`🃏 ${getCardEmoji(card)} بازی شد`);
    
    // Check if trick is complete
    if (session.currentTrick.every(t => t.card !== null)) {
      await completeTrick(ctx, session);
    } else {
      session.currentPlayer = (session.currentPlayer + 1) % 4;
      await updateHokmMessage(ctx, session);
      
      // Play bot turns
      if (session.players[session.currentPlayer].isBot) {
        setTimeout(() => playBotsTurns(ctx, session), 1000);
      }
    }
    return;
  }
}

async function playBotsTurns(ctx: Context, session: HokmSession) {
  while (session.players[session.currentPlayer].isBot && session.status === 'playing') {
    const botPlayer = session.players[session.currentPlayer];
    const playableCards = botPlayer.hand.filter(c => 
      canPlayCard(c, botPlayer.hand, session.currentTrick, session.trumpSuit)
    );
    
    if (playableCards.length === 0) break;
    
    // Simple bot strategy: play highest card of led suit, or trump if can't follow
    const ledSuit = session.currentTrick.find(t => t.card !== null)?.card?.suit;
    let cardToPlay: Card;
    
    if (ledSuit && playableCards.some(c => c.suit === ledSuit)) {
      cardToPlay = playableCards.filter(c => c.suit === ledSuit).sort((a, b) => b.rank - a.rank)[0];
    } else if (session.trumpSuit && playableCards.some(c => c.suit === session.trumpSuit)) {
      cardToPlay = playableCards.filter(c => c.suit === session.trumpSuit).sort((a, b) => b.rank - a.rank)[0];
    } else {
      cardToPlay = playableCards.sort((a, b) => a.rank - b.rank)[0];
    }
    
    const cardIdx = botPlayer.hand.findIndex(c => c.suit === cardToPlay.suit && c.rank === cardToPlay.rank);
    session.currentTrick[session.currentPlayer].card = cardToPlay;
    botPlayer.hand.splice(cardIdx, 1);
    
    session.currentPlayer = (session.currentPlayer + 1) % 4;
    
    await updateHokmMessage(ctx, session);
    
    // Wait a bit between bot plays
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  
  // Check if trick is complete
  if (session.currentTrick.every(t => t.card !== null)) {
    await completeTrick(ctx, session);
  } else {
    await updateHokmMessage(ctx, session);
  }
}

async function completeTrick(ctx: Context, session: HokmSession) {
  const winnerIdx = determineTrickWinner(session.currentTrick, session.trumpSuit!);
  session.players[winnerIdx].tricks++;
  
  // Update scores (team1 = players 0,2; team2 = players 1,3)
  if (winnerIdx === 0 || winnerIdx === 2) {
    session.scores.team1++;
  } else {
    session.scores.team2++;
  }
  
  // Check if round is over
  if (session.scores.team1 >= 7 || session.scores.team2 >= 7) {
    session.status = 'finished';
    const winnerTeam = session.scores.team1 >= 7 ? 1 : 2;
    const humanWon = winnerTeam === 1;
    
    if (humanWon) {
      await awardHokmWinner(ctx, session);
    }
    
    await updateHokmMessage(ctx, session);
    return;
  }
  
  // Start new trick
  session.currentTrick = Array(4).fill(null).map((_, i) => ({ playerId: i, card: null }));
  session.currentPlayer = winnerIdx;
  
  await updateHokmMessage(ctx, session);
  
  // Continue with bot turns if needed
  if (session.players[session.currentPlayer].isBot) {
    setTimeout(() => playBotsTurns(ctx, session), 1000);
  }
}

async function awardHokmWinner(ctx: Context, session: HokmSession) {
  try {
    const user = await prisma.user.findFirst({
      where: { telegramId: BigInt(session.humanPlayerId), botId: (ctx as any).botId },
    });
    if (user) {
      const rewardPoints = 60;
      await prisma.user.update({
        where: { id: user.id },
        data: { points: { increment: rewardPoints } },
      });
      await prisma.pointTransaction.create({
        data: {
          userId: user.id,
          amount: rewardPoints,
          type: 'BONUS',
          description: 'بازی حکم — برنده',
        },
      });
    }
  } catch {}
}

async function updateHokmMessage(ctx: Context, session: HokmSession) {
  const humanPlayer = session.players.find(p => p.id === session.humanPlayerId)!;
  const handStr = sortHand(humanPlayer.hand).map(c => getCardEmoji(c)).join(' ');
  
  let statusText: string;
  if (session.status === 'waiting') {
    statusText = '🎮 برای شروع، دکمه "شروع بازی" را بزنید.';
  } else if (session.status === 'bidding') {
    statusText = `🎯 *حکم را انتخاب کنید:*\n\nکارت‌های شما:\n${handStr}`;
  } else if (session.status === 'playing') {
    const trickStr = session.currentTrick.map((t, i) => {
      if (!t.card) return '⬜';
      return `${session.players[i].name.split(' ')[0]}: ${getCardEmoji(t.card)}`;
    }).join('\n');
    
    statusText = 
      `🃏 *حکم:* ${session.trumpSuit ? suitEmojis[session.trumpSuit] : '...'}\n` +
      `📊 *امتیاز:* تیم ۱: ${session.scores.team1} | تیم ۲: ${session.scores.team2}\n\n` +
      `🎴 *کارت‌های شما:*\n${handStr}\n\n` +
      `🎯 *Trick فعلی:*\n${trickStr || '...'}\n\n` +
      `👤 *نوبت:* ${session.players[session.currentPlayer].name}`;
  } else if (session.status === 'finished') {
    const winnerTeam = session.scores.team1 >= 7 ? 1 : 2;
    const humanWon = winnerTeam === 1;
    statusText = 
      `🏆 *بازی تمام شد!*\n\n` +
      `📊 *امتیاز نهایی:*\n` +
      `تیم ۱: ${session.scores.team1}\n` +
      `تیم ۲: ${session.scores.team2}\n\n` +
      `${humanWon ? '🎉 *تیم شما برنده شد!*' : '😔 *تیم شما باخت!*'}\n` +
      `${humanWon ? '🎯 ۶۰ امتیاز دریافت شد!' : ''}`;
  } else {
    statusText = '';
  }

  const text =
    `🃏 *حکم*\n\n` +
    `${statusText}`;

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...buildHokmKeyboard(session),
    });
  } catch {}
}

function mentionUser(userId: number, name: string): string {
  return `[${name}](tg://user?id=${userId})`;
}

// Cleanup expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > 1800000) {
      sessions.delete(key);
    }
  }
}, 60000);
