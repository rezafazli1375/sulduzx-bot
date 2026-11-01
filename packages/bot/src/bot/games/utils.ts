import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { getSettingBool } from '../../lib/settings.js';
import { getBotId } from '../../lib/bot-context.js';
import { findUserByCtx } from '../../lib/user.js';
import { mainMenuKeyboard } from '../../lib/ui.js';

// ─── Group Check ─────────────────────────────
export async function requireGroup(ctx: Context, gameName: string): Promise<boolean> {
  const chatType = ctx.chat?.type;
  if (chatType === 'private') {
    const botInfo = await ctx.telegram.getMe();
    await ctx.reply(
      `🎮 *بازی ${gameName}*\n\n` +
      `این بازی فقط در *گروه* قابل انجام است!\n\n` +
      `📌 لطفاً ربات @${botInfo.username} را به گروه خود اضافه کنید و سپس بازی را شروع کنید.\n\n` +
      `💡 برای اضافه کردن ربات به گروه:\n` +
      `1️⃣ وارد گروه شوید\n` +
      `2️⃣ به تنظیمات گروه بروید\n` +
      `3️⃣ Add Members را بزنید\n` +
      `4️⃣ @${botInfo.username} را جستجو و اضافه کنید`,
      { parse_mode: 'Markdown', ...await mainMenuKeyboard() }
    );
    return false;
  }
  return true;
}

// ─── Channel Join Check for Games ────────────
export async function checkGameChannelJoin(ctx: Context): Promise<boolean> {
  const forceJoin = await getSettingBool('force_join_channels');
  if (!forceJoin) return true;

  const botId = getBotId(ctx);
  const user = await findUserByCtx(ctx);
  if (!user) return false;

  const channels = await prisma.channel.findMany({
    where: { botId, isRequired: true, isActive: true },
    orderBy: { joinOrder: 'asc' },
  });

  if (channels.length === 0) return true;

  const notJoined: { username: string; title: string }[] = [];

  for (const channel of channels) {
    try {
      const member = await ctx.telegram.getChatMember(
        channel.channelId.toString(),
        ctx.from!.id
      );
      if (!['creator', 'administrator', 'member'].includes(member.status)) {
        notJoined.push({
          username: channel.channelUsername,
          title: channel.title || channel.channelUsername,
        });
      }
    } catch {
      notJoined.push({
        username: channel.channelUsername,
        title: channel.title || channel.channelUsername,
      });
    }
  }

  if (notJoined.length > 0) {
    const channelLinks = notJoined.map((ch) => `📢 ${ch.title}`).join('\n');
    const buttons: any[] = notJoined.map((ch) => [
      Markup.button.url(
        `📢 عضویت در ${ch.title}`,
        `https://t.me/${ch.username.replace(/^@/, '')}`
      ),
    ]);
    buttons.push([Markup.button.callback('✅ بررسی مجدد', 'game_check_membership')]);

    await ctx.reply(
      `⚠️ برای شرکت در بازی‌ها، ابتدا عضو کانال‌های زیر شوید:\n\n${channelLinks}`,
      Markup.inlineKeyboard(buttons)
    );
    return false;
  }

  return true;
}
