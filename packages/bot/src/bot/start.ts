import { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { getSetting, getSettingBool } from '../lib/settings.js';
import { prisma } from '../lib/prisma.js';
import { getText } from '../lib/texts.js';
import { DEFAULT_MENU_BUTTONS, KNOWN_MENU_KEYS, colorPrefix } from '../lib/menu-defaults.js';
import { chunkColumns } from '../lib/ui.js';
import { isFeatureBlocked } from '../lib/restrictions.js';

export async function handleStart(ctx: Context, user: any) {
  const forceJoin = await getSettingBool('force_join_channels');

  if (forceJoin) {
    const joined = await checkChannelMembership(ctx, user);
    if (!joined) return;
  }

  // Check if this is a group chat
  const chatType = ctx.chat?.type;
  if (chatType === 'group' || chatType === 'supergroup') {
    // In groups, only show games menu
    const { handleGames } = await import('./games/index.js');
    await handleGames(ctx);
    return;
  }

  const welcomeMessage = await getSetting('welcome_message');
  await sendMainMenu(ctx, user, welcomeMessage || undefined);
}

async function checkChannelMembership(ctx: Context, user: any) {
  const channels = await prisma.channel.findMany({
    where: { botId: user.botId, isRequired: true, isActive: true },
    orderBy: { joinOrder: 'asc' },
  });

  if (channels.length === 0) return true;

  const notJoined: { username: string; title: string }[] = [];

  for (const channel of channels) {
    try {
      const member = await ctx.telegram.getChatMember(channel.channelId.toString(), ctx.from!.id);
      if (!['creator', 'administrator', 'member'].includes(member.status)) {
        notJoined.push({ username: channel.channelUsername, title: channel.title || channel.channelUsername });
      }
    } catch {
      notJoined.push({ username: channel.channelUsername, title: channel.title || channel.channelUsername });
    }
  }

  if (notJoined.length > 0) {
    const channelLinks = notJoined.map((ch) => `📢 ${ch.title}`).join('\n');
    const buttons: any[] = notJoined.map((ch) => [
      Markup.button.url(`📢 عضویت در ${ch.title}`, `https://t.me/${ch.username.replace(/^@/, '')}`),
    ]);
    buttons.push([Markup.button.callback('✅ بررسی مجدد', 'check_membership')]);

    await ctx.reply(
      `⚠️ برای استفاده از ربات، ابتدا عضو کانال‌های زیر شوید:\n\n${channelLinks}`,
      Markup.inlineKeyboard(buttons)
    );
    return false;
  }

  return true;
}

let menuDefaultsSeeded = false;

export async function ensureDefaultMenuButtons(): Promise<void> {
  if (menuDefaultsSeeded) return;
  await prisma.menuButton.createMany({ data: DEFAULT_MENU_BUTTONS, skipDuplicates: true });
  menuDefaultsSeeded = true;
}

async function loadMenuButtons() {
  await ensureDefaultMenuButtons();

  return prisma.menuButton.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
}

export async function sendMainMenu(ctx: Context, user: any, greeting?: string) {
  const [
    freeEnabled,
    referralEnabled,
    pointsEnabled,
    supportEnabled,
    downloaderEnabled,
    serverStatusEnabled,
    shopEnabled,
    voiceEnabled,
    wordPdfEnabled,
    videoMp3Enabled,
    gamesEnabled,
  ] = await Promise.all([
    getSettingBool('free_account_enabled'),
    getSettingBool('referral_enabled'),
    getSettingBool('points_enabled'),
    getSettingBool('support_enabled'),
    getSettingBool('downloader_enabled'),
    getSettingBool('server_status_check'),
    getSettingBool('shop_enabled'),
    getSettingBool('voice_converter_enabled'),
    getSettingBool('word_pdf_enabled'),
    getSettingBool('video_mp3_enabled'),
    getSettingBool('games_enabled'),
  ]);

  const availability: Record<string, boolean> = {
    free_config: freeEnabled && !user.configBlocked,
    shop: shopEnabled,
    proxy: true,
    referral: referralEnabled,
    points: pointsEnabled,
    downloader: downloaderEnabled,
    voice_convert: voiceEnabled,
    word_to_pdf: wordPdfEnabled,
    video_to_mp3: videoMp3Enabled,
    server_status: serverStatusEnabled,
    games: gamesEnabled,
    support: supportEnabled,
  };

  const menuRows = await loadMenuButtons();

  const visibleButtons = menuRows
    .filter(
      (item) =>
        item.isActive &&
        KNOWN_MENU_KEYS.has(item.key) &&
        availability[item.key] !== false &&
        !isFeatureBlocked(user, item.key)
    )
    .map((item) => Markup.button.callback(`${colorPrefix(item.color)}${item.label}`, item.key));

  const keyboard = chunkColumns(visibleButtons, 2);

  const header = await getText('main_menu.header');
  const hint = await getText('main_menu.hint');

  const message =
    (greeting ? `${greeting}\n\n` : '') +
    `${header}\n\n` +
    `👤 ${ctx.from!.first_name || 'کاربر'}\n` +
    `💰 امتیاز: ${user.points}\n\n` +
    hint;

  await ctx.reply(message, Markup.inlineKeyboard(keyboard));
}
