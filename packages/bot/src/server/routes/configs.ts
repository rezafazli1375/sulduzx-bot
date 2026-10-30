import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';

const router = Router();

function parseBotId(value: unknown) {
  if (value === undefined || value === '') return undefined;
  const botId = Number(value);
  return Number.isInteger(botId) && botId > 0 ? botId : undefined;
}

function searchFilter(search: string) {
  const conditions: any[] = [
    { user: { username: { contains: search, mode: 'insensitive' } } },
    { user: { firstName: { contains: search, mode: 'insensitive' } } },
    { user: { lastName: { contains: search, mode: 'insensitive' } } },
    { email: { contains: search, mode: 'insensitive' } },
  ];
  if (/^\d{3,}$/.test(search)) {
    conditions.push({ user: { telegramId: BigInt(search) } });
  }
  return conditions;
}

const claimSelect = {
  id: true,
  email: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      telegramId: true,
      username: true,
      firstName: true,
      lastName: true,
      bot: { select: { id: true, name: true } },
    },
  },
};

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const botId = parseBotId(req.query.botId);
    const search = String(req.query.search || '').trim();

    const where: any = {};
    if (botId) where.user = { ...(where.user || {}), botId };
    if (search) where.OR = searchFilter(search);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);

    const [claims, total, totalClaims, uniqueUsers, todayClaims, monthClaims] = await Promise.all([
      prisma.configClaim.findMany({
        where,
        select: claimSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.configClaim.count({ where }),
      prisma.configClaim.count(),
      prisma.user.count({ where: { configClaims: { some: {} } } }),
      prisma.configClaim.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.configClaim.count({ where: { createdAt: { gte: startOfMonth } } }),
    ]);

    res.json({
      claims: claims.map((claim) => ({
        ...claim,
        user: { ...claim.user, telegramId: claim.user.telegramId.toString() },
      })),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      stats: { totalClaims, uniqueUsers, todayClaims, monthClaims },
    });
  } catch (error) {
    console.error('Get config claims error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/summary', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const botId = parseBotId(req.query.botId);
    const search = String(req.query.search || '').trim();

    const userWhere: any = {};
    if (botId) userWhere.botId = botId;
    if (search) {
      const conditions: any[] = [
        { username: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
      if (/^\d{3,}$/.test(search)) conditions.push({ telegramId: BigInt(search) });
      userWhere.OR = conditions;
    }

    const matchingUsers = await prisma.user.findMany({
      where: { ...userWhere, configClaims: { some: {} } },
      select: { id: true },
    });
    const userIds = matchingUsers.map((user) => user.id);
    const total = userIds.length;

    if (total === 0) {
      return res.json({ users: [], total: 0, page, totalPages: 1 });
    }

    const grouped = await prisma.configClaim.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _count: { userId: true },
      _max: { createdAt: true },
      orderBy: { _count: { userId: 'desc' } },
      skip: (page - 1) * limit,
      take: limit,
    });

    const users = await prisma.user.findMany({
      where: { id: { in: grouped.map((row) => row.userId) } },
      select: {
        id: true,
        telegramId: true,
        username: true,
        firstName: true,
        lastName: true,
        configBlocked: true,
        configQuotaOverride: true,
        blockedFeatures: true,
        bot: { select: { id: true, name: true } },
      },
    });

    const byId = new Map(users.map((user) => [user.id, user]));

    res.json({
      users: grouped
        .map((row) => {
          const user = byId.get(row.userId);
          if (!user) return null;
          return {
            user: {
              ...user,
              telegramId: user.telegramId.toString(),
            },
            claimedCount: row._count.userId,
            lastClaimAt: row._max.createdAt,
          };
        })
        .filter(Boolean),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('Get config summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const configsRouter = router;
