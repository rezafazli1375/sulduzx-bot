import { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { getText } from '../lib/texts.js';
import { mainMenuButton } from '../lib/ui.js';
import { getBotId } from '../lib/bot-context.js';

const pendingSupport = new Set<string>();

function pendingKey(botId: number, telegramId: number) {
  return `${botId}:${telegramId}`;
}

export function isSupportPending(botId: number, telegramId: number) {
  return pendingSupport.has(pendingKey(botId, telegramId));
}

export function markSupportPending(botId: number, telegramId: number) {
  pendingSupport.add(pendingKey(botId, telegramId));
}

export function clearSupportPending(botId: number, telegramId: number) {
  pendingSupport.delete(pendingKey(botId, telegramId));
}

export async function handleSupport(ctx: Context, user: any) {
  markSupportPending(getBotId(ctx), ctx.from!.id);

  await ctx.reply(
    await getText('support.prompt'),
    Markup.inlineKeyboard([[await mainMenuButton()]])
  );
}

export async function handleSupportMessage(ctx: Context, user: any, text: string) {
  clearSupportPending(getBotId(ctx), ctx.from!.id);

  if (text.length > 2000) {
    await ctx.reply(await getText('support.too_long'), Markup.inlineKeyboard([[await mainMenuButton()]]));
    return;
  }

  try {
    const ticket = await prisma.ticket.create({
      data: {
        userId: user.id,
        subject: 'تیکت پشتیبانی',
        message: text,
        status: 'OPEN',
      },
    });

    await ctx.reply(
      await getText('support.received', { id: ticket.id }),
      Markup.inlineKeyboard([[await mainMenuButton()]])
    );
  } catch (error) {
    console.error('Create ticket error:', error);
    await ctx.reply(await getText('support.error'), Markup.inlineKeyboard([[await mainMenuButton()]]));
  }
}
