import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { getSettingBool } from '../lib/settings.js';
import { getText } from '../lib/texts.js';
import { chunkColumns, mainMenuButton } from '../lib/ui.js';

export async function handleShop(ctx: Context) {
  if (!(await getSettingBool('shop_enabled'))) {
    await ctx.reply(await getText('shop.disabled'), Markup.inlineKeyboard([[await mainMenuButton()]]));
    return;
  }

  const items = await prisma.shopItem.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });

  const title = await getText('shop.title');

  if (items.length === 0) {
    await ctx.reply(
      `${title}\n\n${await getText('shop.empty')}`,
      Markup.inlineKeyboard([[await mainMenuButton()]])
    );
    return;
  }

  const rows = chunkColumns(
    items.map((item) => Markup.button.callback(item.title, `shop_item:${item.id}`)),
    2
  );
  rows.push([await mainMenuButton()]);

  await ctx.reply(`${title}\n\n${await getText('shop.hint')}`, Markup.inlineKeyboard(rows));
}

export async function handleShopItem(ctx: Context, itemId: number) {
  if (!(await getSettingBool('shop_enabled'))) {
    await ctx.answerCbQuery?.(await getText('shop.disabled_cb'));
    return;
  }

  const item = await prisma.shopItem.findFirst({ where: { id: itemId, isActive: true } });
  if (!item) {
    await ctx.answerCbQuery?.(await getText('shop.unavailable'));
    return;
  }

  const rows = [
    [Markup.button.callback('🔙 بازگشت به فروشگاه', 'shop')],
    [await mainMenuButton()],
  ];
  const back = Markup.inlineKeyboard(rows);
  const content = item.content.trim();
  const CHUNK = 4000;

  if (content.length === 0) {
    await ctx.reply('—', back);
    return;
  }

  for (let i = 0; i < content.length; i += CHUNK) {
    const chunk = content.slice(i, i + CHUNK);
    const isLast = i + CHUNK >= content.length;
    await ctx.reply(chunk, isLast ? back : undefined);
  }
}
