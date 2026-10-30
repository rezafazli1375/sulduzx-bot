import { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { getSetting, getSettingBool } from '../lib/settings.js';
import { getText } from '../lib/texts.js';
import { mainMenuButton, mainMenuKeyboard } from '../lib/ui.js';

export async function handlePoints(ctx: Context, user: any) {
  const recentTransactions = await prisma.pointTransaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  let message = `${await getText('points.header')}\n\n`;
  message += `${await getText('points.balance', { points: user.points })}\n\n`;

  if (recentTransactions.length > 0) {
    message += `📜 آخرین تراکنش‌ها:\n\n`;
    for (const tx of recentTransactions) {
      const icon = tx.amount > 0 ? '🟢' : '🔴';
      const typeLabel = getTypeLabel(tx.type);
      message += `${icon} ${typeLabel}: ${tx.amount > 0 ? '+' : ''}${tx.amount}\n`;
      if (tx.description) message += `   ${tx.description}\n`;
      message += `   ${tx.createdAt.toLocaleDateString('fa-IR')}\n\n`;
    }
  } else {
    message += `${await getText('points.empty')}\n\n`;
  }

  await ctx.reply(
    message,
    Markup.inlineKeyboard([
      [Markup.button.callback(await getText('points.checkin'), 'daily_checkin')],
      [await mainMenuButton()],
    ])
  );
}

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    REFERRAL: '👥 رفرال',
    DAILY_CHECKIN: '📅 چک‌این',
    CHANNEL_JOIN: '📢 عضویت کانال',
    BONUS: '🎁 جایزه',
    REDEMPTION: '🎯 مصرف',
  };
  return labels[type] || type;
}

export async function handleDailyCheckin(ctx: Context, user: any) {
  const enabled = await getSettingBool('points_enabled');
  if (!enabled) {
    await ctx.reply('⛔️ سیستم امتیاز غیرفعال است.', await mainMenuKeyboard());
    return;
  }

  const lastCheckin = await prisma.pointTransaction.findFirst({
    where: {
      userId: user.id,
      type: 'DAILY_CHECKIN',
      createdAt: {
        gte: new Date(new Date().setHours(0, 0, 0, 0)),
      },
    },
  });

  if (lastCheckin) {
    await ctx.reply('⏰ امروز قبلاً چک‌این کرده‌اید. فردا دوباره امتحان کنید!', await mainMenuKeyboard());
    return;
  }

  const points = parseInt((await getSetting('daily_checkin_points')) || '10', 10);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { points: { increment: points } },
    }),
    prisma.pointTransaction.create({
      data: {
        userId: user.id,
        amount: points,
        type: 'DAILY_CHECKIN',
        description: 'چک‌این روزانه',
      },
    }),
  ]);

  await ctx.reply(
    `✅ ${points} امتیاز دریافت کردید!\n💰 موجودی: ${user.points + points} امتیاز`,
    await mainMenuKeyboard()
  );
}
