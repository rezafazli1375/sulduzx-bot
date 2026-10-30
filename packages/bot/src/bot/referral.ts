import { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { getText } from '../lib/texts.js';
import { mainMenuButton } from '../lib/ui.js';

export async function handleReferral(ctx: Context, user: any) {
  const botUsername = (ctx.botInfo?.username || '').replace(/^@/, '');
  const referralLink = `https://t.me/${botUsername}?start=${user.referralCode}`;

  const referredCount = await prisma.user.count({
    where: { referredBy: user.id },
  });

  const message = await getText('referral.text', {
    link: referralLink,
    count: referredCount,
    points: user.points,
  });

  await ctx.reply(message, {
    ...Markup.inlineKeyboard([
      [
        Markup.button.switchToChat(
          await getText('referral.share'),
          await getText('referral.share_text', { link: referralLink })
        ),
      ],
      [await mainMenuButton()],
    ]),
    link_preview_options: { is_disabled: true },
  });
}
