import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { getBotInstance, getFirstRunningBot } from '../../bot/index.js';

const router = Router();

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { message, parseMode } = req.body;
    const botIdRaw = req.body?.botId;
    const botId = botIdRaw !== undefined && botIdRaw !== null && botIdRaw !== ''
      ? parseInt(String(botIdRaw), 10)
      : undefined;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (botIdRaw !== undefined && botIdRaw !== null && botIdRaw !== '' && !Number.isInteger(botId)) {
      return res.status(400).json({ error: 'شناسه ربات نامعتبر است' });
    }

    const users = await prisma.user.findMany({
      where: { isBlocked: false, ...(botId ? { botId } : {}) },
      select: { id: true, botId: true, telegramId: true },
    });

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const user of users) {
      try {
        const bot = getBotInstance(user.botId);
        if (!bot) throw new Error('ربات مربوطه فعال نیست');

        await bot.telegram.sendMessage(
          user.telegramId.toString(),
          message,
          parseMode ? { parse_mode: parseMode } : undefined
        );
        sent++;
      } catch (error: any) {
        failed++;
        if (error.description?.includes('bot was blocked')) {
          await prisma.user.update({
            where: { id: user.id },
            data: { isBlocked: true },
          });
        }
        if (errors.length < 10) {
          errors.push(`User ${user.telegramId}: ${error.description || error.message}`);
        }
      }

      if ((sent + failed) % 30 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    res.json({
      success: true,
      stats: { total: users.length, sent, failed },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/preview', async (req: AuthRequest, res: Response) => {
  try {
    const { message, parseMode } = req.body;
    const botId = req.body?.botId ? parseInt(String(req.body.botId), 10) : undefined;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const adminIds = (process.env.ADMIN_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (adminIds.length === 0) {
      return res.status(400).json({ error: 'ADMIN_IDS تنظیم نشده است' });
    }

    const bot = botId ? getBotInstance(botId) : getFirstRunningBot();
    if (!bot) {
      return res.status(400).json({ error: 'ربات انتخاب‌شده فعال نیست' });
    }

    for (const adminId of adminIds) {
      await bot.telegram.sendMessage(
        adminId,
        message,
        parseMode ? { parse_mode: parseMode } : undefined
      );
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Preview error:', error);
    res.status(500).json({ error: error.description || error.message });
  }
});

export const broadcastRouter = router;
