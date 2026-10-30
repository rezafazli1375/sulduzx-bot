import { Context } from 'telegraf';

export type BotContext = Context & { botId?: number };

export function getBotId(ctx: Context): number {
  const botId = (ctx as BotContext).botId;
  if (!botId) throw new Error('Bot id is missing in context');
  return botId;
}
