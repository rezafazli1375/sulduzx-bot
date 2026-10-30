import dotenv from 'dotenv';
dotenv.config();

import { startBots, stopAllBots } from './bot/index.js';
import { startServer } from './server/index.js';
import { prisma } from './lib/prisma.js';
import { ensureDefaultSettings } from './lib/settings.js';
import { ensureDefaultMenuButtons } from './bot/start.js';

async function main() {
  console.log('Starting Sulduz Bot...');

  await prisma.$connect();
  console.log('Database connected');

  await ensureDefaultSettings();
  await ensureDefaultMenuButtons();

  // Start the admin API first so the panel stays reachable even if a bot token is broken.
  await startServer();
  console.log(`Admin API server started on port ${process.env.PORT || 3000}`);

  await startBots();
  console.log('Telegram bots started');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await stopAllBots();
  await prisma.$disconnect();
  process.exit(0);
});
