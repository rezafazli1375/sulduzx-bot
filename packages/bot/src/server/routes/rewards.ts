import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { getPanelClient } from '../../lib/xui-panel.js';

/**
 * پاداش‌های امتیازی: مدیر اینجا تعیین می‌کند «چند امتیاز ← چند گیگ/چند روز»،
 * و می‌بیند چه کسی چه چیزی گرفته است.
 */
const router = Router();

const MAX_TITLE = 64;
const MAX_SUBTITLE = 300;

function parseOptionalInt(value: unknown, name: string, min: number, max: number) {
  if (value === null || value === undefined || value === '') return { value: null };
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    return { error: `${name} باید عددی صحیح بین ${min} تا ${max} باشد یا خالی بماند` };
  }
  return { value: num };
}

function validate(body: any) {
  const title = String(body?.title ?? '').trim();
  if (!title) return { error: 'عنوان پاداش الزامی است' };
  if (title.length > MAX_TITLE) return { error: `عنوان حداکثر ${MAX_TITLE} کاراکتر است` };

  const subtitle = String(body?.subtitle ?? '').trim();
  if (subtitle.length > MAX_SUBTITLE) return { error: `توضیح کوتاه حداکثر ${MAX_SUBTITLE} کاراکتر است` };

  const costPoints = Number(body?.costPoints);
  if (!Number.isInteger(costPoints) || costPoints < 1 || costPoints > 1_000_000) {
    return { error: 'هزینهٔ امتیاز باید عددی صحیح بین ۱ تا ۱٬۰۰۰٬۰۰۰ باشد' };
  }

  const dataGb = Number(body?.dataGb);
  if (!Number.isFinite(dataGb) || dataGb < 0.05 || dataGb > 1000) {
    return { error: 'حجم باید بین ۰٫۰۵ تا ۱۰۰۰ گیگابایت باشد' };
  }

  const days = Number(body?.days);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    return { error: 'مدت زمان باید عددی صحیح بین ۱ تا ۳۶۵۰ روز باشد' };
  }

  const limitIpRaw = Number(body?.limitIp ?? 2);
  if (!Number.isInteger(limitIpRaw) || limitIpRaw < 0 || limitIpRaw > 10) {
    return { error: 'محدودیت IP باید عددی بین ۰ تا ۱۰ باشد' };
  }

  const inbound = parseOptionalInt(body?.inboundId, 'شمارهٔ اینباند', 1, 1_000_000);
  if ('error' in inbound) return { error: inbound.error };

  const maxPerUser = parseOptionalInt(body?.maxPerUser, 'سقف هر کاربر', 1, 1000);
  if ('error' in maxPerUser) return { error: maxPerUser.error };

  const stock = parseOptionalInt(body?.stock, 'موجودی', 0, 1_000_000);
  if ('error' in stock) return { error: stock.error };

  const sortOrder = Number(body?.sortOrder ?? 0);
  if (!Number.isInteger(sortOrder) || sortOrder < -1000 || sortOrder > 1000) {
    return { error: 'ترتیب نمایش باید عددی بین ۱۰۰۰- تا ۱۰۰۰ باشد' };
  }

  return {
    data: {
      title,
      subtitle: subtitle || null,
      costPoints,
      dataGb,
      days,
      limitIp: limitIpRaw,
      inboundId: inbound.value,
      maxPerUser: maxPerUser.value,
      stock: stock.value,
      sortOrder,
      isActive: body?.isActive !== false,
    },
  };
}

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const rewards = await prisma.pointReward.findMany({
      orderBy: [{ sortOrder: 'asc' }, { costPoints: 'asc' }, { id: 'asc' }],
      include: {
        _count: { select: { redemptions: true } },
      },
    });

    // فقط خروج‌هایی که واقعاً کانفیگ شده‌اند شمرده می‌شوند (REFUNDED/PENDING نه)
    const issued = await prisma.rewardRedemption.groupBy({
      by: ['rewardId'],
      where: { status: 'ISSUED', rewardId: { in: rewards.map((r) => r.id) } },
      _count: { _all: true },
    });
    const issuedMap = new Map(issued.map((i) => [i.rewardId as number, i._count._all]));

    res.json(
      rewards.map((reward) => ({
        ...reward,
        issued: issuedMap.get(reward.id) ?? 0,
      }))
    );
  } catch (error) {
    console.error('Get rewards error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** فهرست خرج‌ها — با فیلتر کاربر/پاداش/وضعیت */
router.get('/redemptions', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 500);
    const userId = Number(req.query.userId);
    const rewardId = Number(req.query.rewardId);
    const status = String(req.query.status ?? '').toUpperCase();

    const where: any = {};
    if (Number.isInteger(userId) && userId > 0) where.userId = userId;
    if (Number.isInteger(rewardId) && rewardId > 0) where.rewardId = rewardId;
    if (['PENDING', 'ISSUED', 'FAILED', 'REFUNDED'].includes(status)) where.status = status;

    const rows = await prisma.rewardRedemption.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, telegramId: true, username: true, firstName: true, points: true } },
        reward: { select: { id: true, title: true } },
      },
    });

    res.json(
      rows.map((row) => ({
        ...row,
        user: row.user
          ? {
              ...row.user,
              telegramId: row.user.telegramId.toString(),
            }
          : null,
      }))
    );
  } catch (error) {
    console.error('Get redemptions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * بازگرداندن دستی یک خروج: امتیاز به کاربر برمی‌گردد و کلاینت پنل حذف می‌شود.
 * فقط برای خروج‌های ISSUED که هنوز REFUNDED نشده‌اند.
 */
router.post('/redemptions/:id/revoke', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });

    const redemption = await prisma.rewardRedemption.findUnique({ where: { id } });
    if (!redemption) return res.status(404).json({ error: 'خروجی یافت نشد' });
    if (redemption.status !== 'ISSUED') {
      return res.status(409).json({ error: `وضعیت این خروج ${redemption.status} است؛ فقط خروج موفق قابل بازگردانی است` });
    }

    // اول پنل: اگر کلاینت حذف نشد، امتیاز برنمی‌گردد تا کاربر هم کانفیگ داشته باشد هم امتیاز
    try {
      const panel = await getPanelClient();
      await panel.deleteClient(redemption.email);
    } catch (error: any) {
      console.error('Revoke: delete client failed:', error?.message || error);
      return res.status(502).json({
        error: `کلاینت پنل حذف نشد ⇒ بازگردانی انجام نشد: ${String(error?.message || error).slice(0, 200)}`,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.rewardRedemption.update({
        where: { id },
        data: {
          status: 'REFUNDED',
          failReason: `بازگردانی دستی توسط مدیریت: ${String(req.body?.reason ?? '').trim() || 'بدون دلیل'}`,
        },
      });
      await tx.user.update({
        where: { id: redemption.userId },
        data: { points: { increment: redemption.costPoints } },
      });
      await tx.pointTransaction.create({
        data: {
          userId: redemption.userId,
          amount: redemption.costPoints,
          type: 'REDEMPTION',
          description: 'بازگردانی دستی پاداش توسط مدیریت',
        },
      });
      if (redemption.rewardId !== null) {
        const reward = await tx.pointReward.findUnique({
          where: { id: redemption.rewardId },
          select: { id: true, stock: true },
        });
        if (reward && reward.stock !== null) {
          await tx.pointReward.update({ where: { id: reward.id }, data: { stock: { increment: 1 } } });
        }
      }
      return tx.rewardRedemption.findUnique({ where: { id } });
    });

    res.json(updated);
  } catch (error) {
    console.error('Revoke redemption error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = validate(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const reward = await prisma.pointReward.create({ data: parsed.data as any });
    res.json(reward);
  } catch (error) {
    console.error('Create reward error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });

    const parsed = validate(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    const reward = await prisma.pointReward
      .update({ where: { id }, data: parsed.data as any })
      .catch((error: any) => {
        if (error?.code === 'P2025') return null;
        throw error;
      });

    if (!reward) return res.status(404).json({ error: 'پاداش یافت نشد' });
    res.json(reward);
  } catch (error) {
    console.error('Update reward error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * حذف پاداش. خروجهای قبلی پاک نمی‌شوند (reward_id خالی می‌ماند) تا
 * دفتر امتیاز گم نشود.
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });

    await prisma.rewardRedemption.updateMany({ where: { rewardId: id }, data: { rewardId: null } });
    await prisma.pointReward.delete({ where: { id } }).catch((error: any) => {
      if (error?.code === 'P2025') return null;
      throw error;
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete reward error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const rewardsRouter = router;
