import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { testProxy } from '../../lib/ytdlp-proxy.js';

const router = Router();

router.post('/test', async (req: AuthRequest, res: Response) => {
  try {
    const { mode, url, v2rayConfig } = req.body || {};

    if (mode !== 'socks' && mode !== 'v2ray') {
      return res.status(400).json({ error: 'mode must be "socks" or "v2ray"' });
    }

    if (mode === 'socks' && !String(url || '').trim()) {
      return res.status(400).json({ error: 'socks proxy address is required' });
    }

    if (mode === 'v2ray') {
      const config = String(v2rayConfig || '').trim();
      if (!config) {
        return res.status(400).json({ error: 'v2ray config is required' });
      }
      if (config.length > 20000) {
        return res.status(400).json({ error: 'v2ray config is too large (max 20 KB)' });
      }
    }

    const result = await testProxy({
      mode,
      url: typeof url === 'string' ? url : undefined,
      v2rayConfig: typeof v2rayConfig === 'string' ? v2rayConfig : undefined,
    });

    res.json(result);
  } catch (error) {
    console.error('Test proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const ytdlpRouter = router;
