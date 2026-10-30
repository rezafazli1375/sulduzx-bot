import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { getAllSettings, setSetting, clearSettingsCache, ensureDefaultSettings } from '../../lib/settings.js';

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await ensureDefaultSettings();
    const settings = await getAllSettings();
    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/batch', async (req: AuthRequest, res: Response) => {
  try {
    const { settings } = req.body;

    for (const { key, value } of settings) {
      await setSetting(key, value);
    }
    clearSettingsCache();

    res.json({ success: true });
  } catch (error) {
    console.error('Batch update settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:key', async (req: AuthRequest, res: Response) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    await setSetting(key, value);
    clearSettingsCache();

    res.json({ success: true });
  } catch (error) {
    console.error('Update setting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const settingsRouter = router;
