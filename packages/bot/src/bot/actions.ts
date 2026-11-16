import { Telegraf } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { sendMainMenu } from './start.js';
import { confirmFreeConfig } from './free-config.js';
import { handleProxy } from './proxy.js';
import { handleReferral } from './referral.js';
import { handlePoints, handleDailyCheckin } from './points.js';
import { handleRewards, handleRewardPick, redeemReward } from './points-rewards.js';
import { handleServerStatus } from './server-status.js';
import { handleShop, handleShopItem } from './shop.js';
import { sendVoiceHelp } from './voice-convert.js';
import { sendWordToPdfHelp, sendVideoToMp3Help } from './file-convert.js';
import { getText } from '../lib/texts.js';
import { mainMenuKeyboard } from '../lib/ui.js';
import { getBotId } from '../lib/bot-context.js';
import { findUserByCtx } from '../lib/user.js';
import { handleGameAction, handleGameCheckMembership } from './games/index.js';
import { handleFortune } from './fortune.js';

export function setupActionHandlers(bot: Telegraf) {
  bot.action('main_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const { clearSupportPending } = await import('./support.js');
    clearSupportPending(getBotId(ctx), ctx.from.id);
    const user = await findUserByCtx(ctx);
    if (user) await sendMainMenu(ctx, user);
  });

  bot.action('check_membership', async (ctx) => {
    await ctx.answerCbQuery('در حال بررسی...');
    const user = await findUserByCtx(ctx);
    if (user) {
      const { handleStart } = await import('./start.js');
      await handleStart(ctx, user);
    }
  });

  bot.action('free_config', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await findUserByCtx(ctx);
    if (user) {
      const { handleFreeConfig } = await import('./free-config.js');
      await handleFreeConfig(ctx, user);
    }
  });

  bot.action('confirm_free_config', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await findUserByCtx(ctx);
    if (user) await confirmFreeConfig(ctx, user);
  });

  bot.action('proxy', async (ctx) => {
    await ctx.answerCbQuery();
    await handleProxy(ctx);
  });

  bot.action('referral', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await findUserByCtx(ctx);
    if (user) await handleReferral(ctx, user);
  });

  bot.action('points', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await findUserByCtx(ctx);
    if (user) await handlePoints(ctx, user);
  });

  bot.action('daily_checkin', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await findUserByCtx(ctx);
    if (user) await handleDailyCheckin(ctx, user);
  });

  bot.action('reward:list', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await findUserByCtx(ctx);
    if (user) await handleRewards(ctx, user);
  });

  bot.action(/^reward:pick:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const match = ctx.match as RegExpExecArray | undefined;
    if (!match) return;
    const user = await findUserByCtx(ctx);
    if (user) await handleRewardPick(ctx, user, parseInt(match[1], 10));
  });

  bot.action(/^reward:do:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const match = ctx.match as RegExpExecArray | undefined;
    if (!match) return;
    const user = await findUserByCtx(ctx);
    if (user) await redeemReward(ctx, user, parseInt(match[1], 10));
  });

  bot.action('downloader', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(await getText('downloader.prompt'), await mainMenuKeyboard());
  });

  bot.action('shop', async (ctx) => {
    await ctx.answerCbQuery();
    await handleShop(ctx);
  });

  bot.action(/^shop_item:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const match = ctx.match as RegExpExecArray | undefined;
    if (!match) return;
    await handleShopItem(ctx, parseInt(match[1], 10));
  });

  bot.action('voice_convert', async (ctx) => {
    await ctx.answerCbQuery();
    await sendVoiceHelp(ctx);
  });

  bot.action('word_to_pdf', async (ctx) => {
    await ctx.answerCbQuery();
    await sendWordToPdfHelp(ctx);
  });

  bot.action('video_to_mp3', async (ctx) => {
    await ctx.answerCbQuery();
    await sendVideoToMp3Help(ctx);
  });

  bot.action('server_status', async (ctx) => {
    await ctx.answerCbQuery();
    await handleServerStatus(ctx);
  });

  bot.action('daily_fortune', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await findUserByCtx(ctx);
    if (user) await handleFortune(ctx, user);
  });

  bot.action('support', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await findUserByCtx(ctx);
    if (user) {
      const { handleSupport } = await import('./support.js');
      await handleSupport(ctx, user);
    }
  });

  bot.action('copy_config', async (ctx) => {
    await ctx.answerCbQuery('لینک کپی شد!');
  });

  // ─── Game Actions ──────────────────────────
  bot.action('games', async (ctx) => {
    await handleGameAction(ctx);
  });

  bot.action('game_truth_or_dare', async (ctx) => {
    await handleGameAction(ctx);
  });

  bot.action('game_tic_tac_toe', async (ctx) => {
    await handleGameAction(ctx);
  });

  bot.action('game_minesweeper', async (ctx) => {
    await handleGameAction(ctx);
  });

  bot.action('game_check_membership', async (ctx) => {
    await handleGameCheckMembership(ctx);
  });

  // General channel membership check
  bot.action('check_membership', async (ctx) => {
    await ctx.answerCbQuery('در حال بررسی...');
    const user = await findUserByCtx(ctx);
    if (!user) return;
    const channels = await prisma.channel.findMany({
      where: { botId: getBotId(ctx), isRequired: true, isActive: true },
      orderBy: { joinOrder: 'asc' },
    });
    if (channels.length === 0) {
      await ctx.reply('✅ عضویت شما تأیید شد. حالا می‌توانید از ربات استفاده کنید.');
      return;
    }
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
    if (notJoined.length === 0) {
      await ctx.reply('✅ عضویت شما تأیید شد. حالا می‌توانید از ربات استفاده کنید.');
    } else {
      await ctx.reply('❌ هنوز عضو همه کانال‌ها نشده‌اید.');
    }
  });

  // Truth or Dare actions
  bot.action(/^tod_/, async (ctx) => {
    await handleGameAction(ctx);
  });

  // Tic Tac Toe actions
  bot.action(/^ttt_/, async (ctx) => {
    await handleGameAction(ctx);
  });

  // Minesweeper actions
  bot.action(/^ms_/, async (ctx) => {
    await handleGameAction(ctx);
  });

  // دکمه‌های بازی‌هایی که در نسخهٔ ۲٫۰٫۰ حذف شده‌اند (حکم، منچ، اسکالا، کلمه‌یاب).
  // پیام‌های قدیمی هنوز در گروه‌ها و پیوی‌ها مانده‌اند و بدون این handler کلیکشان
  // هیچ پاسخی نمی‌گرفت و تلگرام ساعت‌ها «در حال منتقل‌کردن» نشان می‌داد.
  // دو شکل دارند: دکمهٔ منوی بازی («game_wordle») و دکمه‌های داخل بازی («wordle_…»).
  bot.action(/^(wordle|hokm|mench|scala)_|^game_(wordle|hokm|mench|scala)$/, async (ctx) => {
    await ctx.answerCbQuery('⏳ این بازی حذف شده است.', { show_alert: true });
  });

  // کارت‌های قدیمیِ پخش موزیک در ویس‌کال («دکمهٔ بعد/توقف»). خودِ قابلیت در
  // ۲٫۰٫۰ حذف شده، اما پیام‌هایش هنوز در گروه‌ها هست؛ بی‌پاسخ نگذاشتنشان
  // همان مشکل «در حال منتقل‌کردن» را برای عضو گروه می‌سازد.
  bot.action(/^vc_(next|stop)(:|$)/, async (ctx) => {
    await ctx.answerCbQuery('⏳ پخش موزیک در ویس‌کال حذف شده است.', { show_alert: true });
  });

  // پخش موزیک دکمه ندارد: آهنگ به‌شکل ویس در گروه می‌نشیند (bot/music.ts)
}
