import { Context, Markup } from 'telegraf';
import type { PointReward, User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getPanelClient, getPanelInboundId } from '../lib/xui-panel.js';
import { getSettingBool } from '../lib/settings.js';
import { mainMenuButton } from '../lib/ui.js';
import { generateUUID, gbToBytes, addDays } from '../lib/utils.js';

/**
 * خرج کردن امتیاز ← کانفیگ.
 *
 * قراردادها:
 *  - کسر امتیاز و ساخت سطر خروج، در یک transaction اتمی و *قبل از* تماس با پنل
 *    انجام می‌شود، با گارد «امتیاز کافی هست؟» ⇒ دو بار خرج‌کردن یک موجودی ممکن نیست.
 *  - اگر پنل خطا داد، امتیاز برمی‌گردد و سطر خروج وضعیت REFUNDED می‌گیرد
 *    (و اگر کلاینت ساخته شده بود، حذف می‌شود).
 *  - ایمیل کلاینت منحصربه‌فرد است و در جدول خروج ثبت می‌شود؛ ردپای کامل برای ادمین.
 */

const CONFIG_BLOCKED_NOTICE = '⛔️ دریافت کانفیگ برای حساب شما توسط مدیریت محدود شده است.';

/**
 * ارسال پیام برای کاربر، بدون پرتاب خطا.
 * اگر کاربر پیوی را بسته باشد، هیچ‌چیز نباید در جریان صدور واکنش
 * «حذف کانفیگ و بازگرداندن امتیاز» را برانگیزد — کانفیگ صادر شده درست است،
 * فقط رسیدن پیام ممکن نیست. خطا فقط لاگ می‌شود.
 */
async function notify(ctx: Context, text: string, extra?: any) {
  try {
    await ctx.reply(text, extra);
  } catch (error: any) {
    console.error('Reward message delivery failed:', error?.description || error?.message || error);
  }
}

/** ضدفشار: هر کاربر هم‌زمان فقط یک عملیات صدور دارد */
const inFlight = new Set<number>();

/** اطلاع‌رسانی «می‌توانید بخرید» برای هر پاداش، حداکثر هر ۳ روز یک‌بار */
const NOTICE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

type Reward = PointReward;
type UserRow = User;

export type BlockReason = 'disabled' | 'admin_blocked' | 'sold_out' | 'per_user_cap' | 'not_enough';

const BLOCK_TEXT: Record<BlockReason, string> = {
  disabled: '⛔️ خرج کردن امتیاز در پنل غیرفعال است.',
  admin_blocked: CONFIG_BLOCKED_NOTICE,
  sold_out: 'تمام شده',
  per_user_cap: 'سقف شما',
  not_enough: 'امتیازتان کم است',
};

export async function rewardsEnabled(): Promise<boolean> {
  return getSettingBool('reward_points_enabled');
}

/** تنها چیزی که به پاداش ربطی ندارد و یک‌جا چک می‌شود: وضعیت کاربر */
function userBlock(user: UserRow): BlockReason | null {
  if (user.configBlocked || user.configQuotaOverride === 0) return 'admin_blocked';
  return null;
}

function rewardBlock(user: UserRow, reward: Reward, redeemedCount: number): BlockReason | null {
  const fromUser = userBlock(user);
  if (fromUser) return fromUser;
  if (reward.stock !== null && reward.stock <= 0) return 'sold_out';
  if (reward.maxPerUser !== null && redeemedCount >= reward.maxPerUser) return 'per_user_cap';
  if (user.points < reward.costPoints) return 'not_enough';
  return null;
}

async function redeemedCounts(userId: number, rewardIds: number[]): Promise<Map<number, number>> {
  if (rewardIds.length === 0) return new Map();
  const groups = await prisma.rewardRedemption.groupBy({
    by: ['rewardId'],
    where: { userId, rewardId: { in: rewardIds }, status: { in: ['PENDING', 'ISSUED'] } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.rewardId as number, g._count._all]));
}

async function loadActiveRewards(): Promise<Reward[]> {
  return prisma.pointReward.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { costPoints: 'asc' }, { id: 'asc' }],
  });
}

/** ارزان‌ترین پاداش فعال؛ برای غربال کردن کاندیداهای اطلاع‌رسانی */
export async function cheapestRewardCost(): Promise<number | null> {
  const rewards = await loadActiveRewards();
  if (rewards.length === 0) return null;
  return Math.min(...rewards.map((r) => r.costPoints));
}

function label(reward: Reward): string {
  const gb = Number.isInteger(reward.dataGb) ? reward.dataGb : reward.dataGb.toFixed(2);
  return `${gb} گیگ / ${reward.days} روز`;
}

/**
 * برچسب دکمهٔ اینلاین. تلگرام حداکثر ۶۴ کاراکتر می‌پذیرد و اگر یک کاراکتر بیشتر
 * شود کل پیام رد می‌شود؛ پس عنوان پاداش همین‌جا کوتاه می‌شود (با احتساب پیشوند و قیمت).
 */
function buttonLabel(prefix: string, title: string, suffix = ''): string {
  const MAX = 64;
  const room = MAX - prefix.length - suffix.length;
  const safeTitle = room > 4 ? title.slice(0, room - 1) + '…' : title.slice(0, Math.max(1, room));
  const text = `${prefix} ${safeTitle}${suffix}`;
  return Array.from(text).slice(0, MAX).join('');
}

// ─── صفحهٔ پاداش‌ها ──────────────────────────────────────────────

export async function handleRewards(ctx: Context, user: UserRow) {
  if (!(await rewardsEnabled())) {
    await notify(
      ctx,
      '🎁 خرج کردن امتیاز فعلاً غیرفعال است.',
      Markup.inlineKeyboard([[await mainMenuButton()]])
    );
    return;
  }

  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  const rewards = await loadActiveRewards();
  const counts = await redeemedCounts(user.id, rewards.map((r) => r.id));

  const lines = [
    '🎁 <b>پاداش‌های امتیازی</b>',
    '',
    `💰 موجودی شما: ${fresh?.points ?? user.points} امتیاز`,
    '',
  ];

  if (rewards.length === 0) {
    lines.push('هنوز پاداشی تعریف نشده است. مدیر از پنل سطح اضافه می‌کند.');
    await notify(ctx, lines.join('\n'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[await mainMenuButton()]]),
    });
    return;
  }

  const rows: any[][] = [];
  for (const reward of rewards) {
    const block = rewardBlock(fresh ?? user, reward, counts.get(reward.id) ?? 0);
    const stock = reward.stock === null ? '' : ` · ${reward.stock} عدد مانده`;
    const cap = reward.maxPerUser === null ? '' : ` · سقف هر نفر ${reward.maxPerUser}`;
    const title = escapeHtml(reward.title);
    lines.push(
      block === null
        ? `✅ ${title} — ${label(reward)} · ${reward.costPoints} امتیاز${stock}${cap}`
        : `▫️ ${title} — ${label(reward)} · ${reward.costPoints} امتیاز — <i>${BLOCK_TEXT[block]}</i>`
    );
    if (block === 'per_user_cap' || block === 'admin_blocked' || block === 'disabled') continue;
    rows.push([
      Markup.button.callback(
        buttonLabel(block === null ? '🎁' : '▫️', reward.title, ` (${reward.costPoints})`),
        `reward:pick:${reward.id}`
      ),
    ]);
  }

  lines.push('', '👇 روی یک پاداش بزنید تا قبل از خرج کردن، جزئیاتش را ببینید.');

  rows.push([await mainMenuButton()]);
  await notify(ctx, lines.join('\n'), {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(rows),
  });
}

// ─── تأییدیه ────────────────────────────────────────────────────

export async function handleRewardPick(ctx: Context, user: UserRow, rewardId: number) {
  const reward = await prisma.pointReward.findFirst({ where: { id: rewardId, isActive: true } });
  if (!reward) {
    await notify(ctx, '⚠️ این پاداش دیگر در لیست نیست.');
    return;
  }

  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  const counts = await redeemedCounts(user.id, [reward.id]);
  const block = rewardBlock(fresh ?? user, reward, counts.get(reward.id) ?? 0);

  if (block === 'not_enough') {
    await notify(
      ctx,
      `🎁 ${reward.title} — ${label(reward)}\n\n` +
        `💰 موجودی شما: ${fresh?.points ?? user.points} امتیاز، اما این پاداش ${reward.costPoints} امتیاز می‌خواهد.\n` +
        `🎮 با بازی کردن و ورود روزانه امتیاز بگیرید.`,
      Markup.inlineKeyboard([[Markup.button.callback('🔙 پاداش‌ها', 'reward:list')], [await mainMenuButton()]])
    );
    return;
  }
  if (block) {
    await notify(
      ctx,
      `⛔️ ${BLOCK_TEXT[block]} — فعلاً نمی‌توانید ${reward.title} بگیرید.`,
      Markup.inlineKeyboard([[Markup.button.callback('🔙 پاداش‌ها', 'reward:list')], [await mainMenuButton()]])
    );
    return;
  }

  const after = (fresh?.points ?? user.points) - reward.costPoints;
  await notify(
    ctx,
    `🎁 <b>${escapeHtml(reward.title)}</b>\n\n` +
      `📦 حجم: ${label(reward)}\n` +
      `💸 هزینه: ${reward.costPoints} امتیاز\n` +
      `💰 بعد از خرج کردن: ${after} امتیاز\n\n` +
      `⚠️ امتیاز خرج می‌شود و کانفیگ ساخته می‌شود؛ اگر ساخت کانفیگ موفق نشود، امتیاز خودکار برمی‌گردد.`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`✅خرج ${reward.costPoints} امتیاز و گرفتن کانفیگ`, `reward:do:${reward.id}`)],
        [Markup.button.callback('🔙 پاداش‌ها', 'reward:list')],
        [await mainMenuButton()],
      ]),
    }
  );
}

// ─── صدور ───────────────────────────────────────────────────────

class NotEnough extends Error {}
class SoldOut extends Error {}
class Capped extends Error {}

export async function redeemReward(ctx: Context, user: UserRow, rewardId: number) {
  if (!(await rewardsEnabled())) {
    await notify(ctx, BLOCK_TEXT.disabled, Markup.inlineKeyboard([[await mainMenuButton()]]));
    return;
  }

  if (inFlight.has(user.id)) {
    await notify(ctx, '⏳ یک درخواست صدور شما در حال انجام است؛ چند لحظه دیگر دوباره امتحان کنید.');
    return;
  }
  inFlight.add(user.id);

  try {
    await doRedeem(ctx, user, rewardId);
  } finally {
    inFlight.delete(user.id);
  }
}

async function doRedeem(ctx: Context, user: UserRow, rewardId: number) {
  const reward = await prisma.pointReward.findFirst({ where: { id: rewardId, isActive: true } });
  if (!reward) {
    await notify(ctx, '⚠️ این پاداش دیگر در لیست نیست.');
    return;
  }
  if (userBlock(user)) {
    await notify(ctx, CONFIG_BLOCKED_NOTICE, Markup.inlineKeyboard([[await mainMenuButton()]]));
    return;
  }

  const back = Markup.inlineKeyboard([[Markup.button.callback('🎁 پاداش‌ها', 'reward:list')], [await mainMenuButton()]]);

  const stamp = Date.now();
  const email = `rwd_${user.botId}_${user.telegramId}_${stamp}`;
  const expiryTime = addDays(new Date(), reward.days).getTime();
  const totalGB = gbToBytes(reward.dataGb);
  // اینباند پاداش (یا پیش‌فرض پنل) قبل از تراکنش خوانده می‌شود تا تراکنش کوتاه بماند
  const inboundId: number = reward.inboundId ?? (await getPanelInboundId());

  // ۱) کسر امتیاز + ثبت خروج + کم‌کردن موجودی، اتمی و زودتر از تماس با پنل
  let redemptionId: number;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const spent = await tx.user.updateMany({
        where: { id: user.id, points: { gte: reward.costPoints } },
        data: { points: { decrement: reward.costPoints } },
      });
      if (spent.count === 0) throw new NotEnough();

      if (reward.stock !== null) {
        const took = await tx.pointReward.updateMany({
          where: { id: reward.id, stock: { gt: 0 } },
          data: { stock: { decrement: 1 } },
        });
        if (took.count === 0) throw new SoldOut();
      }

      if (reward.maxPerUser !== null) {
        const used = await tx.rewardRedemption.count({
          where: { userId: user.id, rewardId: reward.id, status: { in: ['PENDING', 'ISSUED'] } },
        });
        if (used >= reward.maxPerUser) throw new Capped();
      }

      const redemption = await tx.rewardRedemption.create({
        data: {
          userId: user.id,
          rewardId: reward.id,
          email,
          costPoints: reward.costPoints,
          dataGb: reward.dataGb,
          days: reward.days,
          inboundId,
          status: 'PENDING',
        },
      });

      await tx.pointTransaction.create({
        data: {
          userId: user.id,
          amount: -reward.costPoints,
          type: 'REDEMPTION',
          description: `پاداش: ${reward.title} (${label(reward)})`,
        },
      });

      return redemption.id;
    });
    redemptionId = created;
  } catch (error: any) {
    if (error instanceof NotEnough) {
      await notify(ctx, '💰 امتیاز شما برای این پاداش کافی نیست (همین الان خرج شده باشد).', back);
      return;
    }
    if (error instanceof SoldOut) {
      await notify(ctx, `📦 موجودی پاداش «${reward.title}» تمام شده است.`, back);
      return;
    }
    if (error instanceof Capped) {
      await notify(ctx, `⚠️ سقف دریافت «${reward.title}» برای هر کاربر را پر کرده‌اید.`, back);
      return;
    }
    console.error('Reward reserve error:', error);
    await notify(ctx, `⚠️ خرج کردن انجام نشد: ${error?.message || 'خطای نامعلوم'}`, back);
    return;
  }

  // ۲) ساخت کلاینت در پنل (خارج از transaction — شبکه نباید قفل دیتابیس را نگه دارد)
  let clientCreated = false;
  let links: string[] = [];
  try {
    const panel = await getPanelClient();
    const uuid = generateUUID();
    await panel.addClient(inboundId, {
      email,
      id: uuid,
      totalGB,
      expiryTime,
      enable: true,
      limitIp: reward.limitIp,
    });
    clientCreated = true;

    const fetched = await panel.getClientLinks(email);
    if (!fetched || fetched.length === 0) throw new Error('پنل لینک کانفیگ را برنگرداند');
    links = fetched;

    await prisma.rewardRedemption.update({ where: { id: redemptionId }, data: { status: 'ISSUED' } });
    await prisma.user.update({ where: { id: user.id }, data: { panelUserName: email } });
  } catch (error: any) {
    const reason = String(error?.message || error || 'خطای نامعلوم').slice(0, 500);
    console.error('Reward issuance error:', error);

    if (clientCreated) {
      try {
        const panel = await getPanelClient();
        await panel.deleteClient(email);
      } catch (cleanupError) {
        console.error('Reward cleanup error:', cleanupError);
      }
    }

    // ۳) بازگرداندن امتیاز و موجودی
    try {
      await prisma.$transaction(async (tx) => {
        await tx.rewardRedemption.update({
          where: { id: redemptionId },
          data: { status: 'REFUNDED', failReason: reason },
        });
        await tx.user.update({
          where: { id: user.id },
          data: { points: { increment: reward.costPoints } },
        });
        await tx.pointTransaction.create({
          data: {
            userId: user.id,
            amount: reward.costPoints,
            type: 'REDEMPTION',
            description: `بازگشت امتیاز — ${reward.title}`,
          },
        });
        if (reward.stock !== null) {
          await tx.pointReward.update({ where: { id: reward.id }, data: { stock: { increment: 1 } } });
        }
      });
    } catch (refundError) {
      console.error('Reward refund error:', refundError);
    }

    await notify(
      ctx,
      `⚠️ ساخت کانفیگ موفق نشد و امتیاز ${reward.costPoints} تان برگشت.\n` +
        `📝 ${reason}\n\n` +
        `💬 اگر این پیام تکرار شد، به پشتیبانی خبر دهید.`,
      back
    );
    return;
  }

  // ۴) تحویل کانفیگ. نرسیدن پیام به معنی بی‌اعتبار بودن صدور نیست، پس اینجا
  // هیچ بازگرداندنی انجام نمی‌شود؛ سطر ISSUED در پنل برای ادمین دیدنی است.
  const balance = await prisma.user.findUnique({ where: { id: user.id }, select: { points: true } });
  const linksBlock = links.map((l) => `<code>${escapeHtml(l)}</code>`).join('\n');

  await notify(
    ctx,
    `🎁 <b>${escapeHtml(reward.title)}</b> صادر شد\n\n` +
      `📦 ${escapeHtml(label(reward))}\n` +
      `📅 اعتبار تا ${formatDate(new Date(expiryTime))}\n` +
      `💰 موجودی امتیاز: ${balance?.points ?? 0}\n\n` +
      linksBlock,
    {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...Markup.inlineKeyboard([[Markup.button.callback('🎁 پاداش‌ها', 'reward:list')], [await mainMenuButton()]]),
    }
  );
}

// ─── اطلاع‌رسانی حد نصاب ─────────────────────────────────────────

/**
 * گران‌ترین پاداشی که کاربر همین الان می‌تواند بگیرد (موجودی و سقف هم حساب می‌شود).
 */
async function bestRewardFor(user: UserRow): Promise<Reward | null> {
  const rewards = await loadActiveRewards();
  if (rewards.length === 0) return null;
  const counts = await redeemedCounts(user.id, rewards.map((r) => r.id));
  const affordable = rewards.filter((r) => rewardBlock(user, r, counts.get(r.id) ?? 0) === null);
  if (affordable.length === 0) return null;
  return affordable.reduce((a, b) => (b.costPoints >= a.costPoints ? b : a));
}

/**
 * یک بار «می‌توانید پاداش بگیرید» برای این کاربر. اگر قبلاً برای همین پاداش
 * (کمتر از ۳ روز پیش) فرستاده شده، چیزی نمی‌فرستد.
 *
 * پیام حتی وقتی ارسال شکست بخورد (کاربر پیوی را بسته) علامت‌گذاری می‌شود تا
 * هر بار دوباره تلاش و اسپم نشود. بازگرداندن: 'sent' | 'skipped' | 'failed'
 */
export async function sendRewardNotice(
  telegram: { sendMessage: (chatId: string, text: string, extra?: any) => Promise<any> },
  userId: number
): Promise<'sent' | 'skipped' | 'failed'> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || userBlock(user)) return 'skipped';

  const best = await bestRewardFor(user);
  if (!best) return 'skipped';

  const key = String(best.id);
  if (
    user.rewardNoticeKey === key &&
    user.rewardNoticeAt &&
    Date.now() - user.rewardNoticeAt.getTime() < NOTICE_COOLDOWN_MS
  ) {
    return 'skipped';
  }

  const text =
    `🎁 با ${user.points} امتیازتان می‌توانید پاداش بگیرید\n\n` +
    `✅ ${best.title} — ${label(best)} · ${best.costPoints} امتیاز\n\n` +
    `👉 از بخش «امتیازها» → «🎁 پاداش‌ها» بگیرید.`;

  try {
    await telegram.sendMessage(user.telegramId.toString(), text, { disable_web_page_preview: true });
  } catch {
    await prisma.user.update({
      where: { id: userId },
      data: { rewardNoticeKey: key, rewardNoticeAt: new Date() },
    });
    return 'failed';
  }

  await prisma.user.update({
    where: { id: userId },
    data: { rewardNoticeKey: key, rewardNoticeAt: new Date() },
  });
  return 'sent';
}


function formatDate(date: Date) {
  return date.toLocaleDateString('fa-IR');
}

function escapeHtml(value: string) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
