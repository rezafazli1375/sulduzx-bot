import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { getBotInstance } from '../../bot/index.js';

const router = Router();

async function resolveChannelId(botId: number, rawId: any, username?: string): Promise<bigint> {
  const idStr = String(rawId ?? '').trim();
  if (/^-?\d+$/.test(idStr)) return BigInt(idStr);

  const handle = String(username ?? '').trim();

  const bot = getBotInstance(botId);
  if (!bot) {
    throw new Error('ربات انتخاب‌شده فعال نیست؛ شناسه عددی کانال را وارد کنید یا ربات را فعال کنید');
  }
  if (!handle) {
    throw new Error('شناسه عددی یا نام کاربری کانال لازم است');
  }

  const chat = await bot.telegram.getChat(handle.startsWith('@') ? handle : `@${handle}`);
  return BigInt(chat.id);
}

function serializeChannel(channel: any) {
  return { ...channel, channelId: channel.channelId.toString() };
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const botIdRaw = req.query.botId;
    const botId = botIdRaw !== undefined ? parseInt(String(botIdRaw), 10) : undefined;

    if (botIdRaw !== undefined && !Number.isInteger(botId)) {
      return res.status(400).json({ error: 'شناسه ربات نامعتبر است' });
    }

    const channels = await prisma.channel.findMany({
      where: botId ? { botId } : undefined,
      orderBy: [{ joinOrder: 'asc' }, { id: 'asc' }],
      include: { bot: { select: { id: true, name: true, username: true } } },
    });

    res.json(channels.map(serializeChannel));
  } catch (error) {
    console.error('Get channels error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { channelId, channelUsername, title, isRequired, joinOrder } = req.body;
    const botId = parseInt(String(req.body?.botId), 10);

    if (!Number.isInteger(botId)) {
      return res.status(400).json({ error: 'انتخاب ربات الزامی است' });
    }

    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) {
      return res.status(400).json({ error: 'ربات انتخاب‌شده یافت نشد' });
    }

    if (!channelUsername) {
      return res.status(400).json({ error: 'نام کاربری کانال الزامی است' });
    }

    const handle = String(channelUsername).trim();
    const resolvedId = await resolveChannelId(botId, channelId, handle);

    const channel = await prisma.channel.create({
      data: {
        botId,
        channelId: resolvedId,
        channelUsername: handle.startsWith('@') ? handle : `@${handle}`,
        title,
        isRequired: isRequired ?? true,
        joinOrder: joinOrder ?? 0,
      },
    });

    res.json(serializeChannel(channel));
  } catch (error: any) {
    console.error('Create channel error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'این کانال قبلاً برای این ربات ثبت شده است' });
    }
    res.status(400).json({ error: error.message || 'اطلاعات کانال نامعتبر است' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { channelId, channelUsername, title, isRequired, joinOrder, isActive } = req.body;

    const existing = await prisma.channel.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return res.status(404).json({ error: 'کانال یافت نشد' });
    }

    const resolvedId =
      channelId || channelUsername
        ? await resolveChannelId(existing.botId, channelId, channelUsername)
        : undefined;

    const channel = await prisma.channel.update({
      where: { id: existing.id },
      data: {
        channelId: resolvedId,
        channelUsername: channelUsername
          ? String(channelUsername).startsWith('@')
            ? String(channelUsername)
            : `@${channelUsername}`
          : undefined,
        title,
        isRequired,
        joinOrder,
        isActive,
      },
    });

    res.json(serializeChannel(channel));
  } catch (error: any) {
    console.error('Update channel error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'این کانال قبلاً برای این ربات ثبت شده است' });
    }
    res.status(400).json({ error: error.message || 'اطلاعات کانال نامعتبر است' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.channel.delete({ where: { id: parseInt(id) } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete channel error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const channelsRouter = router;
