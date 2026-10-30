import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const proxies = await prisma.mtprotoProxy.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(proxies);
  } catch (error) {
    console.error('Get proxies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { server, port, secret, isActive } = req.body;
    const parsedPort = parseInt(port, 10);

    if (!server || !secret || !Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      return res.status(400).json({ error: 'سرور، پورت (۱-۶۵۵۳۵) و secret الزامی هستند' });
    }

    const proxy = await prisma.mtprotoProxy.create({
      data: {
        server: String(server).trim(),
        port: parsedPort,
        secret: String(secret).trim(),
        isActive: isActive ?? true,
      },
    });

    res.json(proxy);
  } catch (error) {
    console.error('Create proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { server, port, secret, isActive } = req.body;
    const parsedPort = port !== undefined ? parseInt(port, 10) : undefined;

    if (parsedPort !== undefined && (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535)) {
      return res.status(400).json({ error: 'پورت باید عددی بین ۱ تا ۶۵۵۳۵ باشد' });
    }

    const proxy = await prisma.mtprotoProxy.update({
      where: { id: parseInt(id) },
      data: {
        server,
        port: parsedPort,
        secret,
        isActive,
      },
    });

    res.json(proxy);
  } catch (error) {
    console.error('Update proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.mtprotoProxy.delete({ where: { id: parseInt(id) } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const proxyRouter = router;
