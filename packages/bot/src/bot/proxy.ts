import { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { getText } from '../lib/texts.js';
import { mainMenuButton } from '../lib/ui.js';

export async function handleProxy(ctx: Context) {
  const proxies = await prisma.mtprotoProxy.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  const title = await getText('proxy.title');

  if (proxies.length === 0) {
    await ctx.reply(
      await getText('proxy.empty'),
      Markup.inlineKeyboard([[await mainMenuButton()]])
    );
    return;
  }

  let message = `${title}\n\n`;
  const buttons: any[] = [];

  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    message += `${i + 1}. سرور: ${proxy.server}\n`;
    message += `   پورت: ${proxy.port}\n\n`;

    const proxyLink = `tg://proxy?server=${proxy.server}&port=${proxy.port}&secret=${proxy.secret}`;
    buttons.push([
      Markup.button.url(await getText('proxy.button', { n: i + 1 }), proxyLink),
    ]);
  }

  buttons.push([await mainMenuButton()]);

  await ctx.reply(message, Markup.inlineKeyboard(buttons));
}
