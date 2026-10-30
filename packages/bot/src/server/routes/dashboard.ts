import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const [
      totalUsers,
      activeUsers,
      totalChannels,
      totalTickets,
      openTickets,
      totalDownloads,
      totalProxies,
      totalBots,
      totalConfigClaims,
      configUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isBlocked: false } }),
      prisma.channel.count(),
      prisma.ticket.count(),
      prisma.ticket.count({ where: { status: 'OPEN' } }),
      prisma.download.count({ where: { status: 'COMPLETED' } }),
      prisma.mtprotoProxy.count({ where: { isActive: true } }),
      prisma.bot.count({ where: { isActive: true } }),
      prisma.configClaim.count(),
      prisma.user.count({ where: { configClaims: { some: {} } } }),
    ]);

    const recentUsers = await prisma.user.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        telegramId: true,
        username: true,
        firstName: true,
        createdAt: true,
        bot: { select: { name: true } },
      },
    });

    const recentTickets = await prisma.ticket.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { firstName: true, username: true } } },
    });

    const recentClaims = await prisma.configClaim.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            telegramId: true,
            firstName: true,
            username: true,
            bot: { select: { name: true } },
          },
        },
      },
    });

    res.json({
      stats: {
        totalUsers,
        activeUsers,
        totalChannels,
        totalTickets,
        openTickets,
        totalDownloads,
        totalProxies,
        totalBots,
        totalConfigClaims,
        configUsers,
      },
      recentUsers: recentUsers.map((u) => ({ ...u, telegramId: u.telegramId.toString() })),
      recentTickets,
      recentClaims: recentClaims.map((claim) => ({
        ...claim,
        user: { ...claim.user, telegramId: claim.user.telegramId.toString() },
      })),
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const dashboardRouter = router;
