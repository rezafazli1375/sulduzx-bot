import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { isFeatureKey } from '../../lib/restrictions.js';

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 50, search, botId: botIdRaw } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const searchTerm = String(search || '').trim();
    const botId = botIdRaw !== undefined && botIdRaw !== '' ? parseInt(String(botIdRaw), 10) : undefined;

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
        orderBy: { createdAt: 'desc' },
        include: {
          bot: { select: { id: true, name: true, username: true } },
          _count: {
            select: { tickets: true, downloads: true, configClaims: true },
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

export const usersRouter = router;
