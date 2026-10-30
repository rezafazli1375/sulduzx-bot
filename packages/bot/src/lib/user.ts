import { Context } from 'telegraf';
import { prisma } from './prisma.js';
import { getBotId } from './bot-context.js';

export function telegramIdOf(ctx: Context): bigint {
  return BigInt(ctx.from!.id);
}

export async function findUserByCtx(ctx: Context) {
  return prisma.user.findUnique({
    where: {
      botId_telegramId: {
        botId: getBotId(ctx),
        telegramId: telegramIdOf(ctx),
      },
    },
  });
}
