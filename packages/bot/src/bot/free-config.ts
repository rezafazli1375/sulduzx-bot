import { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { getPanelClient, getPanelInboundId } from '../lib/xui-panel.js';
import { getSetting, getSettingBool, getSettingNumber } from '../lib/settings.js';
import { getText } from '../lib/texts.js';
import { mainMenuButton } from '../lib/ui.js';
import { generateUUID, gbToBytes, addDays } from '../lib/utils.js';

function getPeriod(limitType: string) {
  const now = new Date();

  if (limitType === 'daily') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const next = new Date(start);
    next.setDate(next.getDate() + 1);
    return { start, next, name: 'روز' };
  }

  if (limitType === 'weekly') {
    const day = now.getDay(); // 0 = Sunday
    const diff = day === 0 ? 6 : day - 1; // Monday as start of week
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
    const next = new Date(start);
    next.setDate(next.getDate() + 7);
    return { start, next, name: 'هفته' };
  }

  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, next, name: 'ماه' };
}

function formatDate(date: Date) {
  return date.toLocaleDateString('fa-IR');
}

const CONFIG_BLOCKED_NOTICE = '⛔️ دریافت کانفیگ برای حساب شما توسط مدیریت محدود شده است.';

function resolveMaxCount(user: any, fallback: number) {
  const override = user?.configQuotaOverride;
  return typeof override === 'number' && Number.isInteger(override) ? override : fallback;
}

export async function handleFreeConfig(ctx: Context, user: any) {
  if (user.configBlocked || user.configQuotaOverride === 0) {
    await ctx.reply(CONFIG_BLOCKED_NOTICE, Markup.inlineKeyboard([[await mainMenuButton()]]));
    return;
  }

  const enabled = await getSettingBool('free_account_enabled');
  if (!enabled) {
    await ctx.reply(await getText('free.disabled'), Markup.inlineKeyboard([[await mainMenuButton()]]));
    return;
  }

  const limitType = (await getSetting('free_config_limit_type')) || 'monthly';
  const maxCount = resolveMaxCount(user, parseInt((await getSetting('free_config_max_count')) || '1', 10));

  if (limitType !== 'none') {
    const { start, next, name } = getPeriod(limitType);

    const count = await prisma.configClaim.count({
      where: { userId: user.id, createdAt: { gte: start } },
    });

    if (count >= maxCount) {
      await ctx.reply(
        await getText('free.limit', {
          period: name,
          count: maxCount,
          used: count,
          next: formatDate(next),
        }),
        Markup.inlineKeyboard([[await mainMenuButton()]])
      );
      return;
    }
  }

  const dataLimitGb = (await getSettingNumber('free_data_limit_gb')) || 1;
  const daysLimit = (await getSettingNumber('free_days_limit')) || 7;

  await ctx.reply(
    await getText('free.prompt', { gb: dataLimitGb, days: daysLimit }),
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ دریافت کانفیگ', 'confirm_free_config')],
      [await mainMenuButton()],
    ])
  );
}

export async function confirmFreeConfig(ctx: Context, user: any) {
  if (user.configBlocked || user.configQuotaOverride === 0) {
    await ctx.reply(CONFIG_BLOCKED_NOTICE, Markup.inlineKeyboard([[await mainMenuButton()]]));
    return;
  }

  const limitType = (await getSetting('free_config_limit_type')) || 'monthly';
  const maxCount = resolveMaxCount(user, parseInt((await getSetting('free_config_max_count')) || '1', 10));

  if (limitType !== 'none') {
    const { start, next, name } = getPeriod(limitType);
    const count = await prisma.configClaim.count({
      where: { userId: user.id, createdAt: { gte: start } },
    });

    if (count >= maxCount) {
      await ctx.reply(
        await getText('free.quota', { period: name, next: formatDate(next) }),
        Markup.inlineKeyboard([[await mainMenuButton()]])
      );
      return;
    }
  }

  const dataLimitGb = (await getSettingNumber('free_data_limit_gb')) || 1;
  const daysLimit = (await getSettingNumber('free_days_limit')) || 7;

  const email = `free_${user.botId}_${user.telegramId}_${Date.now()}`;
  let created = false;

  try {
    const inboundId = await getPanelInboundId();
    const panelClient = await getPanelClient();
    const uuid = generateUUID();
    const expiryTime = addDays(new Date(), daysLimit).getTime();

    await panelClient.addClient(inboundId, {
      email,
      id: uuid,
      totalGB: gbToBytes(dataLimitGb),
      expiryTime,
      enable: true,
      limitIp: 2,
    });
    created = true;

    const links = await panelClient.getClientLinks(email);
    if (!links || links.length === 0) {
      throw new Error('پنل لینک کانفیگ را برنگرداند');
    }

    await prisma.$transaction([
      prisma.configClaim.create({ data: { userId: user.id, email } }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          freeAccountUsed: true,
          freeAccountAt: new Date(),
          panelUserName: email,
        },
      }),
    ]);

    const linksBlock = links.map((l) => `<code>${escapeHtml(l)}</code>`).join('\n');

    const message = await getText('free.success', {
      gb: dataLimitGb,
      days: daysLimit,
      expiry: formatDate(new Date(expiryTime)),
      links: linksBlock,
    });

    await ctx.reply(message, {
      ...Markup.inlineKeyboard([[await mainMenuButton()]]),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (error: any) {
    console.error('Free config error:', error);

    if (created) {
      try {
        const panelClient = await getPanelClient();
        await panelClient.deleteClient(email);
      } catch (cleanupError) {
        console.error('Free config cleanup error:', cleanupError);
      }
    }

    await ctx.reply(
      await getText('free.error', { error: error.message }),
      Markup.inlineKeyboard([[await mainMenuButton()]])
    );
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
