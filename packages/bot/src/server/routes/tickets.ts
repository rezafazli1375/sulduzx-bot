import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { sendMessageToTelegramId } from '../../bot/index.js';

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where = status ? { status: status as any } : {};

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { firstName: true, username: true, telegramId: true } },
        },
      }),
      prisma.ticket.count({ where }),
    ]);

    res.json({
      tickets: tickets.map((t) => ({
        ...t,
        user: { ...t.user, telegramId: t.user.telegramId.toString() },
      })),
      total,
      page: parseInt(page as string),
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, adminReply, priority } = req.body;

    const ticket = await prisma.ticket.update({
      where: { id: parseInt(id) },
      data: {
        status,
        adminReply,
        priority,
        repliedBy: req.adminId,
        repliedAt: adminReply ? new Date() : undefined,
        closedAt: status === 'CLOSED' ? new Date() : undefined,
      },
    });

    if (adminReply?.trim()) {
      const user = await prisma.user.findUnique({
        where: { id: ticket.userId },
        select: { telegramId: true, botId: true },
      });

      if (user) {
        await sendMessageToTelegramId(
          user.botId,
          user.telegramId,
          `📬 پاسخ پشتیبانی\n\n🎫 تیکت #${ticket.id}\n\n${adminReply}`
        ).catch((err) => console.error('Ticket notify error:', err.message));
      }
    }

    res.json({ ...ticket, adminReply: ticket.adminReply });
  } catch (error) {
    console.error('Update ticket error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const ticketsRouter = router;
