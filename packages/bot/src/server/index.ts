import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { channelsRouter } from './routes/channels.js';
import { settingsRouter } from './routes/settings.js';
import { proxyRouter } from './routes/proxy.js';
import { usersRouter } from './routes/users.js';
import { ticketsRouter } from './routes/tickets.js';
import { downloadsRouter } from './routes/downloads.js';
import { broadcastRouter } from './routes/broadcast.js';
import { shopRouter } from './routes/shop.js';
import { menuRouter } from './routes/menu.js';
import { textsRouter } from './routes/texts.js';
import { botsRouter } from './routes/bots.js';
import { backupRouter } from './routes/backup.js';
import { accountRouter } from './routes/account.js';
import { configsRouter } from './routes/configs.js';
import { ytdlpRouter } from './routes/ytdlp.js';
import { gamesRouter } from './routes/games.js';
import { authenticateToken } from './middleware/auth.js';

export function startServer() {
  const app = express();
  const port = parseInt(process.env.PORT || '3000', 10);

  app.use(cors());
  app.use(express.json({ limit: '30mb' }));

  app.use('/api/auth', authRouter);
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });
  app.use('/api', authenticateToken);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/channels', channelsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/proxy', proxyRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/tickets', ticketsRouter);
  app.use('/api/downloads', downloadsRouter);
  app.use('/api/broadcast', broadcastRouter);
  app.use('/api/shop', shopRouter);
  app.use('/api/menu', menuRouter);
  app.use('/api/texts', textsRouter);
  app.use('/api/bots', botsRouter);
  app.use('/api/backup', backupRouter);
  app.use('/api/account', accountRouter);
  app.use('/api/configs', configsRouter);
  app.use('/api/ytdlp', ytdlpRouter);
  app.use('/api/games', gamesRouter);

  app.listen(port, () => {
    console.log(`Admin API server running on http://localhost:${port}`);
  });
}
