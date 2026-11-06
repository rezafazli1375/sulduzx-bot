import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { isFeatureKey } from '../../lib/restrictions.js';

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 50, search, botId: botIdRaw, sort } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const searchTerm = String(search || '').trim();
    const botId = botIdRaw !== undefined && botIdRaw !== '' ? parseInt(String(botIdRaw), 10) : undefined;

    // 'points' برای مرتب‌سازی ستون امتیاز در پنل؛ هر چیز دیگر همان ترتیب زمانی همیشگی است
    const orderBy = sort === 'points' ? [{ points: 'desc' as const }, { id: 'asc' as const }] : { createdAt: 'desc' as const };

    let where: any = botId ? { botId } : {};
    if (searchTerm) {
      const conditions: any[] = [
        { username: { contains: searchTerm, mode: 'insensitive' } },
        { firstName: { contains: searchTerm, mode: 'insensitive' } },
        { lastName: { contains: searchTerm, mode: 'insensitive' } },
      ];
      if (/^\d{3,}$/.test(searchTerm)) {
        conditions.push({ telegramId: { equals: BigInt(searchTerm) } });
      }
      where = { ...where, OR: conditions };
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy,
        include: {
          bot: { select: { id: true, name: true, username: true } },
          _count: {
            select: { tickets: true, downloads: true, configClaims: true, redemptions: true },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users: users.map((u) => ({
        ...u,
        telegramId: u.telegramId.toString(),
      })),
      total,
      page: parseInt(page as string),
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: parseInt(id) },
      include: {
        bot: { select: { id: true, name: true, username: true } },
        tickets: { orderBy: { createdAt: 'desc' }, take: 10 },
        downloads: { orderBy: { createdAt: 'desc' }, take: 10 },
        pointTransactions: { orderBy: { createdAt: 'desc' }, take: 20 },
        channelStatuses: { include: { channel: true } },
        configClaims: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      ...user,
      telegramId: user.telegramId.toString(),
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/block', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isBlocked } = req.body;

    const user = await prisma.user.update({
      where: { id: parseInt(id) },
      data: { isBlocked },
    });

    res.json(user);
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/restrictions', async (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ error: 'شناسه کاربر نامعتبر است' });
    }

    const { configBlocked, configQuotaOverride, blockedFeatures } = req.body || {};
    const data: {
      configBlocked?: boolean;
      configQuotaOverride?: number | null;
      blockedFeatures?: string[];
    } = {};

    if (typeof configBlocked === 'boolean') {
      data.configBlocked = configBlocked;
    }

    if (configQuotaOverride === null || configQuotaOverride === '') {
      data.configQuotaOverride = null;
    } else if (configQuotaOverride !== undefined) {
      const quota = Number(configQuotaOverride);
      if (!Number.isInteger(quota) || quota < 0 || quota > 1000) {
        return res.status(400).json({ error: 'سهمیه کانفیگ باید عددی بین ۰ تا ۱۰۰۰ باشد' });
      }
      data.configQuotaOverride = quota;
    }

    if (Array.isArray(blockedFeatures)) {
      const unique = Array.from(new Set(blockedFeatures.map(String)));
      const invalid = unique.filter((key) => !isFeatureKey(key));
      if (invalid.length > 0) {
        return res.status(400).json({ error: `ویژگی نامعتبر: ${invalid.join(', ')}` });
      }
      data.blockedFeatures = unique;
      if (unique.includes('free_config')) {
        data.configBlocked = true;
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'هیچ تغییری ارسال نشده است' });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        configBlocked: true,
        configQuotaOverride: true,
        blockedFeatures: true,
      },
    });

    res.json(user);
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ error: 'کاربر یافت نشد' });
    }
    console.error('Update user restrictions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * تنظیم دستی امتیاز (جایزه یا کسر). هر تغییر در point_transactions ثبت می‌شود
 * تا ردپای کامل بماند؛ کسر بیشتر از موجودی مجاز نیست.
 */
router.post('/:id/points', async (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ error: 'شناسه کاربر نامعتبر است' });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
      return res.status(400).json({ error: 'مقدار امتیاز باید عددی غیرصفر و کمتر از ۱٬۰۰۰٬۰۰۰ باشد' });
    }

    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) {
      return res.status(400).json({ error: 'ذکر دلیل الزامی است' });
    }
    if (reason.length > 300) {
      return res.status(400).json({ error: 'دلیل حداکثر ۳۰۰ کاراکتر است' });
    }

    const user = await prisma.$transaction(async (tx) => {
      if (amount < 0) {
        // کسر فقط تا اندازهٔ موجودی؛ اگر کم بود هیچ سطر تغییر نمی‌کند
        const taken = await tx.user.updateMany({
          where: { id: userId, points: { gte: -amount } },
          data: { points: { decrement: -amount } },
        });
        if (taken.count === 0) {
          const exists = await tx.user.findUnique({ where: { id: userId }, select: { points: true } });
          if (!exists) throw Object.assign(new Error('not_found'), { code: 'P2025' });
          throw Object.assign(new Error(`موجودی کاربر (${exists.points}) برای این کسر کافی نیست`), {
            code: 'INSUFFICIENT',
          });
        }
      } else {
        const given = await tx.user.updateMany({
          where: { id: userId },
          data: { points: { increment: amount } },
        });
        if (given.count === 0) throw Object.assign(new Error('not_found'), { code: 'P2025' });
      }

      await tx.pointTransaction.create({
        data: {
          userId,
          amount,
          type: 'BONUS',
          description: `توسط مدیریت: ${reason}`,
        },
      });

      return tx.user.findUnique({
        where: { id: userId },
        select: { id: true, points: true, telegramId: true },
      });
    });

    res.json({ id: user!.id, points: user!.points, telegramId: user!.telegramId.toString() });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ error: 'کاربر یافت نشد' });
    }
    if (error?.code === 'INSUFFICIENT') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Adjust user points error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const usersRouter = router;
