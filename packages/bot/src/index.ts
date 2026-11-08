import dotenv from 'dotenv';
dotenv.config();

import { startBots, stopAllBots } from './bot/index.js';
import { startServer } from './server/index.js';
import { prisma } from './lib/prisma.js';
import { ensureDefaultSettings } from './lib/settings.js';
import { startMusicScheduler, stopMusicScheduler } from './lib/music-schedule.js';
import { startRadioLoop, stopRadioLoop } from './bot/voicecall.js';
import { startRewardNoticeSweeper, stopRewardNoticeSweeper } from './lib/reward-notice.js';
import { startBackupScheduler, stopBackupScheduler } from './lib/backup-scheduler.js';
import { ensureDefaultMenuButtons } from './bot/start.js';
import { APP_INFO } from './lib/app-info.js';

async function main() {
  console.log('Starting Sulduz Bot...');

  await prisma.$connect();
  console.log('Database connected');

  await ensureDefaultSettings();
  await ensureDefaultMenuButtons();

  // Start the admin API first so the panel stays reachable even if a bot token is broken.
  await startServer();
  // امضای نسخه در لاگ: با `docker logs` مشخص می‌شود دقیقاً کدام بیلد بالا آمده.
  console.log(
    `Admin API server started on port ${process.env.PORT || 3000} — ` +
      `${APP_INFO.name} v${APP_INFO.version} · ${APP_INFO.author}` +
      (APP_INFO.buildTime ? ` · build ${APP_INFO.buildTime}` : '')
  );

  await startBots();
  console.log('Telegram bots started');

  // جاروی اطلاع‌رسانی پاداش‌ها: بعد از استارت ربات‌ها، چون برای ارسال پیوی به
  // نمونهٔ زندهٔ همان ربات نیاز دارد.
  startRewardNoticeSweeper();

  // پخش خودکار موزیک: بعد از بالا آمدن ربات‌ها، چون ارسال‌ها به نمونهٔ زندهٔ
  // همان ربات نیاز دارند. اجرای جا‌مانده در زمان استارت هم همان لحظه بررسی می‌شود.
  startMusicScheduler();

  // حلقهٔ رادیوی ویس‌کال: بعد از ربات‌ها، چون ویرایش کارت گروه به نمونهٔ زندهٔ
  // همان ربات نیاز دارد. اگر سرویس sulduz-voice پایین باشد فقط خطا می‌گیرد و
  // بعد از چند بار نرسیدن، رادیوهای باز را خاموش می‌کند.
  startRadioLoop();
  console.log('Voice-call radio loop started');

  // زمان‌بندی بکاپ خودکار: هر ۶۰ ثانیه بررسی می‌کند آیا زمان اجرا رسیده است.
  startBackupScheduler();
  console.log('Backup scheduler started');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// ─── مدیریت خطاهای پیش‌بینی‌نشده — جلوگیری از کرش کامل پروسس ───
// این handlerها تضمین می‌کنند که یک خطای ناشناخته (مثلاً در یک middleware یا timer)
// کل پروسس را نکشد. ربات‌های دیگر و API سرور به کار خود ادامه می‌دهند.
process.on('unhandledRejection', (reason: any) => {
  console.error('[unhandledRejection]', reason?.message || reason);
});

process.on('uncaughtException', (error: Error) => {
  console.error('[uncaughtException]', error.message, error.stack);
  // در صورت خطای بحرانی، پروسس را نمی‌بندیم — Docker restart می‌کند اگر لازم باشد
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  stopMusicScheduler();
  stopRadioLoop();
  stopRewardNoticeSweeper();
  stopBackupScheduler();
  await stopAllBots();
  await prisma.$disconnect();
  process.exit(0);
});
