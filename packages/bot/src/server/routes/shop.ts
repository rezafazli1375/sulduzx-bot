import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';

const router = Router();

function validate(body: any) {
  const title = String(body.title ?? '').trim();
  const content = String(body.content ?? '');

  if (!title) return { error: 'عنوان دکمه الزامی است' };
  if (title.length > 64) return { error: 'عنوان دکمه حداکثر ۶۴ کاراکتر است' };
  if (!content.trim()) return { error: 'متن پیام الزامی است' };
  if (content.length > 4000) return { error: 'متن پیام حداکثر ۴۰۰۰ کاراکتر است' };

  return { title, content };
}

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const items = await prisma.shopItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    res.json(items);
  } catch (error) {
    console.error('Get shop items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = validate(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    const item = await prisma.shopItem.create({
      data: {
        title: parsed.title!,
        content: parsed.content!,
        sortOrder: Number.isFinite(Number(req.body.sortOrder)) ? parseInt(req.body.sortOrder, 10) : 0,
        isActive: req.body.isActive ?? true,
      },
    });

    res.json(item);
  } catch (error) {
    console.error('Create shop item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = validate(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    const item = await prisma.shopItem.update({
      where: { id: parseInt(req.params.id) },
      data: {
        title: parsed.title!,
        content: parsed.content!,
        sortOrder: Number.isFinite(Number(req.body.sortOrder)) ? parseInt(req.body.sortOrder, 10) : 0,
        isActive: req.body.isActive ?? true,
      },
    });

    res.json(item);
  } catch (error) {
    console.error('Update shop item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.shopItem.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete shop item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const shopRouter = router;
