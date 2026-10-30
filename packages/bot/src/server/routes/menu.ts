import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { DEFAULT_MENU_BUTTONS, KNOWN_MENU_KEYS, MENU_COLORS } from '../../lib/menu-defaults.js';

const router = Router();

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    if ((await prisma.menuButton.count()) === 0) {
      await prisma.menuButton.createMany({ data: DEFAULT_MENU_BUTTONS, skipDuplicates: true });
    }

    const buttons = await prisma.menuButton.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    res.json(buttons);
  } catch (error) {
    console.error('Get menu buttons error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/batch', async (req: AuthRequest, res: Response) => {
  try {
    const items = Array.isArray(req.body?.buttons) ? req.body.buttons : [];

    for (const item of items) {
      const id = parseInt(item.id, 10);
      if (!Number.isInteger(id)) continue;

      const label = String(item.label ?? '').trim();
      if (!label || label.length > 64) {
        return res.status(400).json({ error: 'عنوان دکمه باید بین ۱ تا ۶۴ کاراکتر باشد' });
      }

      const color = MENU_COLORS.includes(item.color) ? item.color : 'none';
      const sortOrder = Number.isFinite(Number(item.sortOrder)) ? parseInt(item.sortOrder, 10) : 0;

      await prisma.menuButton.update({
        where: { id },
        data: { label, color, sortOrder, isActive: Boolean(item.isActive) },
      });
    }

    const buttons = await prisma.menuButton.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    res.json(buttons);
  } catch (error) {
    console.error('Update menu buttons error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const key = String(req.body?.key ?? '').trim();
    if (!KNOWN_MENU_KEYS.has(key)) {
      return res.status(400).json({ error: 'کلید دکمه نامعتبر است' });
    }

    const exists = await prisma.menuButton.findUnique({ where: { key } });
    if (exists) return res.status(400).json({ error: 'این دکمه قبلاً وجود دارد' });

    const label = String(req.body?.label ?? '').trim();
    if (!label || label.length > 64) {
      return res.status(400).json({ error: 'عنوان دکمه باید بین ۱ تا ۶۴ کاراکتر باشد' });
    }

    const button = await prisma.menuButton.create({
      data: {
        key,
        label,
        color: MENU_COLORS.includes(req.body?.color) ? req.body.color : 'none',
        sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? parseInt(req.body.sortOrder, 10) : 0,
        isActive: req.body?.isActive ?? true,
      },
    });

    res.json(button);
  } catch (error) {
    console.error('Create menu button error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const menuRouter = router;
