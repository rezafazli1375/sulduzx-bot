import { Telegraf, Context, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { prisma } from '../lib/prisma.js';
import { getSetting, getSettingBool } from '../lib/settings.js';
import { generateReferralCode } from '../lib/utils.js';
import { getBotId } from '../lib/bot-context.js';
import { findUserByCtx, telegramIdOf } from '../lib/user.js';
import { getText } from '../lib/texts.js';
import { mainMenuKeyboard } from '../lib/ui.js';
import { handleStart } from './start.js';
import { handleMenu } from './menu.js';
import { handleFreeConfig } from './free-config.js';
import { handleProxy } from './proxy.js';
import { handleReferral } from './referral.js';
import { handlePoints, handleDailyCheckin } from './points.js';
import { handleSupport, isSupportPending, handleSupportMessage } from './support.js';
import { handleDownloader } from './downloader.js';
import { handleServerStatus } from './server-status.js';
import { handleVoiceToMp3, handleAudioToVoice, sendVoiceHelp } from './voice-convert.js';
import {
  isWordDocument,
  isVideoDocument,
  handleWordToPdf,
  handleVideoToMp3,
} from './file-convert.js';
import { setupActionHandlers } from './actions.js';
import { registerFeatureGuard } from '../lib/restrictions.js';

// ─── Channel Membership Check ────────────────
async function checkChannelMembership(ctx: Context, user: any): Promise<boolean> {
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
      Markup.button.url(
        `📢 عضویت در ${ch.title}`,
        `https://t.me/${ch.username.replace(/^@/, '')}`
      ),
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

export function createBotInstance(botId: number, token: string): Telegraf {
  const bot = new Telegraf(token);

  bot.use(async (ctx, next) => {
    (ctx as Context & { botId?: number }).botId = botId;
    return next();
  });

  // ─── Group Restriction: Only /games allowed ────
  bot.use(async (ctx, next) => {
    const chatType = ctx.chat?.type;
    if (chatType === 'group' || chatType === 'supergroup') {
      // Check if it's a command
      const text = (ctx.message as any)?.text;
      if (text && text.startsWith('/')) {
        // Allow /start and /games
        if (text.startsWith('/start') || text.startsWith('/games')) {
          return next();
        }
        // Ignore all other commands in groups
        return;
      }
      // Ignore non-command messages in groups
      return;
    }
    return next();
  });

  // ─── Channel Membership Check (Private Only) ────
  bot.use(async (ctx, next) => {
    const chatType = ctx.chat?.type;
    if (chatType === 'private') {
      const forceJoin = await getSettingBool('force_join_channels');
      if (forceJoin) {
        const user = await findUserByCtx(ctx);
        if (user) {
          const joined = await checkChannelMembership(ctx, user);
          if (!joined) return;
        }
      }
    }
    return next();
  });

  registerFeatureGuard(bot);

  async function getUser(ctx: Context) {
    if (!(await getSettingBool('bot_enabled'))) {
      await ctx.reply('⛔️ ربات موقتاً غیرفعال است. لطفاً بعداً مراجعه کنید.');
      return null;
    }

    const user = await findUserByCtx(ctx);
    if (!user) {
      await ctx.reply('❌ لطفاً ابتدا /start را بزنید.');
      return null;
    }
    if (user.isBlocked) {
      await ctx.reply('⛔️ شما مسدود شده‌اید.');
      return null;
    }
    return user;
  }

  bot.start(async (ctx) => {
    if (!(await getSettingBool('bot_enabled'))) {
      await ctx.reply('⛔️ ربات موقتاً غیرفعال است. لطفاً بعداً مراجعه کنید.');
      return;
    }

    const telegramId = telegramIdOf(ctx);
    const args = ctx.payload;

    let user = await findUserByCtx(ctx);

    if (!user) {
      let referredBy: number | null = null;
      if (args) {
        const referrer = await prisma.user.findFirst({
          where: { referralCode: args, botId },
          select: { id: true },
        });
        if (referrer) referredBy = referrer.id;
      }

      user = await prisma.user.create({
        data: {
          botId,
          telegramId,
          username: ctx.from.username || null,
          firstName: ctx.from.first_name || null,
          lastName: ctx.from.last_name || null,
          referralCode: generateReferralCode(),
          referredBy,
        },
      });

      if (referredBy) {
        const referralEnabled = await getSettingBool('referral_enabled');
        if (referralEnabled) {
          const rewardPoints = parseInt((await getSetting('referral_reward_points')) || '100', 10);
          await prisma.user.update({
            where: { id: referredBy },
            data: { points: { increment: rewardPoints } },
          });
          await prisma.pointTransaction.create({
            data: {
              userId: referredBy,
              amount: rewardPoints,
              type: 'REFERRAL',
              description: `دعوت کاربر ${ctx.from.first_name || ctx.from.username || 'جدید'}`,
            },
          });
        }
      }
    }

    if (user.isBlocked) {
      await ctx.reply('⛔️ شما مسدود شده‌اید.');
      return;
    }

    await handleStart(ctx, user);
  });

  bot.command('menu', async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await handleMenu(ctx, user);
  });

  bot.command('free', async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await handleFreeConfig(ctx, user);
  });

  bot.command('proxy', async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await handleProxy(ctx);
  });

  bot.command('referral', async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await handleReferral(ctx, user);
  });

  bot.command('points', async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await handlePoints(ctx, user);
  });

  bot.command('checkin', async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await handleDailyCheckin(ctx, user);
  });

  bot.command('support', async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await handleSupport(ctx, user);
  });

  bot.command('download', async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await ctx.reply(await getText('downloader.prompt'), await mainMenuKeyboard());
  });

  bot.command('voice', async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await sendVoiceHelp(ctx);
  });

  bot.command('status', async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await handleServerStatus(ctx);
  });

  bot.command('admin', async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;

    const adminIds = (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim());
    if (!adminIds.includes(String(ctx.from.id))) {
      await ctx.reply('⛔️ دسترسی ندارید.');
      return;
    }

    await ctx.reply(
      `🔧 پنل مدیریت:\n\n${process.env.ADMIN_PANEL_URL || 'ADMIN_PANEL_URL تنظیم نشده است'}`
    );
  });

  bot.on(message('text'), async (ctx) => {
    const text = ctx.message.text;

    if (text.startsWith('/')) return;

    const user = await getUser(ctx);
    if (!user) return;

    if (isSupportPending(getBotId(ctx), ctx.from.id)) {
      await handleSupportMessage(ctx, user, text);
      return;
    }

    if (
      text.startsWith('http') &&
      (text.includes('instagram.com') || text.includes('youtube.com') || text.includes('youtu.be'))
    ) {
      await handleDownloader(ctx, user, text);
      return;
    }

    await handleMenu(ctx, user);
  });

  bot.on(message('voice'), async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await handleVoiceToMp3(ctx);
  });

  bot.on(message('audio'), async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;
    await handleAudioToVoice(ctx);
  });

  bot.on(message('video'), async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return;

    const video = ctx.message.video;
    await handleVideoToMp3(ctx, {
      fileId: video.file_id,
      fileSize: video.file_size,
      fileName: video.file_name,
      duration: video.duration,
    });
  });

  bot.on(message('document'), async (ctx) => {
    const doc = ctx.message.document;
    const isMp3 = doc.mime_type === 'audio/mpeg' || /\.mp3$/i.test(doc.file_name || '');
    const isWord = isWordDocument(doc);
    const isVideo = isVideoDocument(doc);

    if (!isMp3 && !isWord && !isVideo) return;

    const user = await getUser(ctx);
    if (!user) return;

    if (isMp3) {
      await handleAudioToVoice(ctx);
      return;
    }

    if (isWord) {
      await handleWordToPdf(ctx, doc);
      return;
    }

    await handleVideoToMp3(ctx, {
      fileId: doc.file_id,
      fileSize: doc.file_size,
      fileName: doc.file_name,
    });
  });

  setupActionHandlers(bot);

  return bot;
}
