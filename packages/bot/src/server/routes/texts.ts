import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { ensureDefaultTexts, clearTextsCache } from '../../lib/texts.js';

const router = Router();

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    await ensureDefaultTexts();

    const texts = await prisma.botText.findMany({ orderBy: { key: 'asc' } });
    res.json(texts);
  } catch (error) {
    console.error('Get bot texts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/batch', async (req: AuthRequest, res: Response) => {
  try {
    const items = Array.isArray(req.body?.texts) ? req.body.texts : [];

    for (const item of items) {
      const key = String(item?.key ?? '').trim();
      if (!key) continue;

      const value = String(item?.value ?? '');
      if (value.length > 4000) {
        return res.status(400).json({ error: `متن ${key} بیشتر از ۴۰۰۰ کاراکتر است` });
      }

      await prisma.botText.update({ where: { key }, data: { value } });
    }

    clearTextsCache();

    const texts = await prisma.botText.findMany({ orderBy: { key: 'asc' } });
    res.json(texts);
  } catch (error) {
    console.error('Update bot texts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const textsRouter = router;
