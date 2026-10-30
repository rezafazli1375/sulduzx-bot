import { Router, Response } from 'express';
import { Telegraf } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { reloadBots, getBotRuntime } from '../../bot/index.js';

const router = Router();

const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

async function resolveUsername(token: string): Promise<string | undefined> {
  const probe = new Telegraf(token);
  const getMe = probe.telegram.getMe();
  const me = await Promise.race([
    getMe,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('ارتباط با تلگرام برقرار نشد (timeout)')), 15000)
    ),
  ]);
  return me.username;
}

async function serialize(bot: any) {
  const [users, channels] = await Promise.all([
    prisma.user.count({ where: { botId: bot.id } }),
    prisma.channel.count({ where: { botId: bot.id } }),
  ]);

  return {
    ...bot,
    usersCount: users,
    channelsCount: channels,
    runtime: getBotRuntime(bot.id),
  };
}

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const bots = await prisma.bot.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    res.json(await Promise.all(bots.map(serialize)));
  } catch (error) {
    console.error('Get bots error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const token = String(req.body?.token ?? '').trim();
    const isActive = req.body?.isActive ?? true;
    const sortOrder = Number.isFinite(Number(req.body?.sortOrder))
      ? parseInt(req.body.sortOrder, 10)
      : 50;

    if (!name) {
      return res.status(400).json({ error: 'نام ربات الزامی است' });
    }
    if (!TOKEN_RE.test(token)) {
      return res.status(400).json({ error: 'فرمت توکن ربات معتبر نیست' });
    }

    const duplicate = await prisma.bot.findUnique({ where: { token } });
    if (duplicate) {
      return res.status(400).json({ error: 'این توکن قبلاً برای ربات دیگری ثبت شده است' });
    }

    let username: string | undefined;
    try {
      username = await resolveUsername(token);
    } catch (error: any) {
      return res.status(400).json({
        error: `توکن ربات نامعتبر است: ${error?.description || error?.message || 'خطای تلگرام'}`,
      });
    }

    const bot = await prisma.bot.create({
      data: { name, token, username, isActive: Boolean(isActive), sortOrder },
    });

    await reloadBots();
    res.json(await serialize(bot));
  } catch (error) {
    console.error('Create bot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'شناسه ربات نامعتبر است' });
    }

    const existing = await prisma.bot.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'ربات یافت نشد' });
    }

    const data: any = {};

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'نام ربات الزامی است' });
      data.name = name;
    }

    if (req.body?.isActive !== undefined) {
      data.isActive = Boolean(req.body.isActive);
    }

    if (req.body?.sortOrder !== undefined) {
      data.sortOrder = Number.isFinite(Number(req.body.sortOrder))
        ? parseInt(req.body.sortOrder, 10)
        : existing.sortOrder;
    }

    if (req.body?.token !== undefined) {
      const token = String(req.body.token).trim();
      if (!TOKEN_RE.test(token)) {
        return res.status(400).json({ error: 'فرمت توکن ربات معتبر نیست' });
      }

      if (token !== existing.token) {
        const duplicate = await prisma.bot.findUnique({ where: { token } });
        if (duplicate) {
          return res.status(400).json({ error: 'این توکن قبلاً برای ربات دیگری ثبت شده است' });
        }

        try {
          data.username = await resolveUsername(token);
        } catch (error: any) {
          return res.status(400).json({
            error: `توکن ربات نامعتبر است: ${error?.description || error?.message || 'خطای تلگرام'}`,
          });
        }
        data.token = token;
      }
    }

    const bot = await prisma.bot.update({ where: { id }, data });
    await reloadBots();
    res.json(await serialize(bot));
  } catch (error) {
    console.error('Update bot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'شناسه ربات نامعتبر است' });
    }

    const [users, channels] = await Promise.all([
      prisma.user.count({ where: { botId: id } }),
      prisma.channel.count({ where: { botId: id } }),
    ]);

    if (users > 0 || channels > 0) {
      return res.status(400).json({
        error: 'این ربات کاربر یا کانال دارد؛ برای حذف ابتدا داده‌ها را منتقل/حذف کنید یا ربات را غیرفعال کنید',
      });
    }

    await prisma.bot.delete({ where: { id } });
    await reloadBots();
    res.json({ success: true });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ error: 'ربات یافت نشد' });
    }
    console.error('Delete bot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const botsRouter = router;
