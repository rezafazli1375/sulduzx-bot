import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';

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
            select: { tickets: true, downloads: true },
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

export const usersRouter = router;
