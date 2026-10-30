import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where = status ? { status: status as any } : {};

    const [downloads, total] = await Promise.all([
      prisma.download.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { firstName: true, username: true } },
        },
      }),
      prisma.download.count({ where }),
    ]);

    res.json({
      data: downloads,
      total,
      page: parseInt(page as string),
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (error) {
    console.error('Get downloads error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const downloadsRouter = router;
