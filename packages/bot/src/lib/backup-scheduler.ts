// ─── زمان‌بندی بکاپ خودکار ──────────────────────────────────────────
// هر ۶۰ ثانیه تنظیمات را بررسی می‌کند. اگر backup_auto_enabled فعال باشد
// و زمان اجرا رسیده باشد، بکاپ می‌سازد و (اگر backup_auto_send فعال باشد)
// به تلگرام ارسال می‌کند. زمان اجرای بعدی بر اساس interval محاسبه می‌شود.

import { prisma } from './prisma.js';
import { getSetting, getSettingBool, getSettingNumber, setSetting, clearSettingsCache } from './settings.js';
import { getBotInstance } from '../bot/index.js';
import { InputFile } from 'telegraf/types';
import fs from 'fs';
import path from 'path';

const BACKUP_DIR = process.env.BACKUP_DIR || '/app/data/backups';
const FORMAT = 'sulduz-backup';
const VERSION = 1;
const NAME_PATTERN = /^[A-Za-z0-9._-]+\.json$/;
const TICK_MS = 60_000; // هر ۶۰ ثانیه بررسی

type BackupCounts = Record<string, number>;

interface BackupPayload {
  format: string;
  version: number;
  createdAt: string;
  counts: BackupCounts;
  data: {
    bots: any[];
    users: any[];
    channels: any[];
    configClaims: any[];
    userChannelStatuses: any[];
    tickets: any[];
    downloads: any[];
    pointTransactions: any[];
    settings: any[];
    menuButtons: any[];
    botTexts: any[];
    shopItems: any[];
    mtprotoProxies: any[];
    auditLogs: any[];
    pointRewards: any[];
    rewardRedemptions: any[];
  };
}

const DATA_KEYS = [
  'bots',
  'users',
  'channels',
  'configClaims',
  'userChannelStatuses',
  'tickets',
  'downloads',
  'pointTransactions',
  'settings',
  'menuButtons',
  'botTexts',
  'shopItems',
  'mtprotoProxies',
  'auditLogs',
] as const;

const OPTIONAL_KEYS = ['pointRewards', 'rewardRedemptions'] as const;

let timerHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

async function collectData(): Promise<BackupPayload> {
  const [
    bots,
    users,
    channels,
    configClaims,
    userChannelStatuses,
    tickets,
    downloads,
    pointTransactions,
    settings,
    menuButtons,
    botTexts,
    shopItems,
    mtprotoProxies,
    auditLogs,
    pointRewards,
    rewardRedemptions,
  ] = await Promise.all([
    prisma.bot.findMany({ orderBy: { id: 'asc' } }),
    prisma.user.findMany({ orderBy: { id: 'asc' } }),
    prisma.channel.findMany({ orderBy: { id: 'asc' } }),
    prisma.configClaim.findMany({ orderBy: { id: 'asc' } }),
    prisma.userChannelStatus.findMany({ orderBy: { id: 'asc' } }),
    prisma.ticket.findMany({ orderBy: { id: 'asc' } }),
    prisma.download.findMany({ orderBy: { id: 'asc' } }),
    prisma.pointTransaction.findMany({ orderBy: { id: 'asc' } }),
    prisma.setting.findMany({ orderBy: { id: 'asc' } }),
    prisma.menuButton.findMany({ orderBy: { id: 'asc' } }),
    prisma.botText.findMany({ orderBy: { id: 'asc' } }),
    prisma.shopItem.findMany({ orderBy: { id: 'asc' } }),
    prisma.mtprotoProxy.findMany({ orderBy: { id: 'asc' } }),
    prisma.auditLog.findMany({ orderBy: { id: 'asc' } }),
    prisma.pointReward.findMany({ orderBy: { id: 'asc' } }),
    prisma.rewardRedemption.findMany({ orderBy: { id: 'asc' } }),
  ]);

  const data = {
    bots,
    users: users.map((user) => ({ ...user, telegramId: user.telegramId.toString() })),
    channels: channels.map((channel) => ({ ...channel, channelId: channel.channelId.toString() })),
    configClaims,
    userChannelStatuses,
    tickets,
    downloads,
    pointTransactions,
    settings,
    menuButtons,
    botTexts,
    shopItems,
    mtprotoProxies,
    auditLogs,
    pointRewards,
    rewardRedemptions,
  };

  const counts: BackupCounts = {};
  for (const key of [...DATA_KEYS, ...OPTIONAL_KEYS]) counts[key] = (data[key] as any[]).length;

  return {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    counts,
    data,
  };
}

async function writeBackup(payload: BackupPayload, prefix = 'auto'): Promise<{ name: string; size: number }> {
  ensureDir();
  const name = `sulduz-${prefix}-${stamp()}.json`;
  const full = path.join(BACKUP_DIR, name);
  const body = JSON.stringify(payload, null, 2);
  fs.writeFileSync(full, body, 'utf8');
  return { name, size: Buffer.byteLength(body, 'utf8') };
}

function pruneBackups(retention: number) {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((file) => NAME_PATTERN.test(file))
    .map((file) => ({ file, mtime: fs.statSync(path.join(BACKUP_DIR, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const stale of files.slice(retention)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, stale.file));
    } catch {
      // ignore
    }
  }
}

/**
 * محاسبهٔ زمان اجرای بعدی بر اساس interval و ساعت تنظیم‌شده
 */
function computeNextRun(interval: string, customHours: number, timeStr: string): Date {
  const now = new Date();
  const [hours, minutes] = timeStr.split(':').map(Number);
  
  let next = new Date(now);
  next.setHours(hours || 0, minutes || 0, 0, 0);

  // اگر ساعت تنظیم‌شده امروز گذشته، از فردا شروع کن
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  switch (interval) {
    case 'daily':
      // هر روز در ساعت مشخص
      break;
    case 'weekly':
      // هر هفته، همان روز و ساعت
      while (next.getDay() !== now.getDay() || next <= now) {
        next.setDate(next.getDate() + 1);
      }
      break;
    case 'monthly':
      // هر ماه، همان روز و ساعت
      while (next.getDate() !== now.getDate() || next <= now) {
        next.setDate(next.getDate() + 1);
      }
      break;
    case 'custom':
      // هر customHours ساعت
      if (customHours > 0) {
        next = new Date(now.getTime() + customHours * 60 * 60 * 1000);
      }
      break;
    default:
      // پیش‌فرض: روزانه
      break;
  }

  return next;
}

/**
 * به‌روزرسانی زمان اجرای بعدی در تنظیمات
 */
async function updateNextRunTime() {
  const enabled = await getSettingBool('backup_auto_enabled');
  if (!enabled) {
    await setSetting('backup_next_run_at', '');
    return;
  }

  const interval = (await getSetting('backup_auto_interval')) || 'daily';
  const customHours = (await getSettingNumber('backup_auto_custom_hours')) || 24;
  const timeStr = (await getSetting('backup_auto_time')) || '03:00';

  const next = computeNextRun(interval, customHours, timeStr);
  await setSetting('backup_next_run_at', next.toISOString());
}

/**
 * اجرای بکاپ خودکار
 */
async function runAutoBackup(): Promise<{ name: string; size: number } | null> {
  try {
    const payload = await collectData();
    const result = await writeBackup(payload, 'auto');
    
    // prune بر اساس retention
    const retention = (await getSettingNumber('backup_auto_retention')) || 20;
    pruneBackups(retention);

    // به‌روزرسانی last_run_at و next_run_at
    await setSetting('backup_last_run_at', new Date().toISOString());
    await updateNextRunTime();
    clearSettingsCache();

    console.log(`[backup-scheduler] Auto backup created: ${result.name} (${result.size} bytes)`);
    return result;
  } catch (error) {
    console.error('[backup-scheduler] Auto backup failed:', error);
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * ارسال بکاپ به شناسهٔ تلگرام با ربات انتخاب‌شده
 */
async function sendBackupToTelegram(backupName: string): Promise<{ ok: boolean; error?: string }> {
  const chatId = await getSetting('backup_telegram_chat_id');
  const botId = await getSettingNumber('backup_bot_id');

  if (!chatId || !botId) {
    return { ok: false, error: 'تنظیمات ارسال بکاپ کامل نیست (chat ID یا bot ID خالی)' };
  }

  const full = path.join(BACKUP_DIR, backupName);
  if (!fs.existsSync(full)) {
    return { ok: false, error: 'فایل بکاپ پیدا نشد' };
  }

  const bot = getBotInstance(botId);
  if (!bot) {
    return { ok: false, error: `ربات ${botId} در دسترس نیست یا فعال نیست` };
  }

  try {
    const stat = fs.statSync(full);
    const fileStream = fs.createReadStream(full);
    const inputFile: InputFile = { source: fileStream, filename: backupName };

    const caption = `📦 بکاپ خودکار سولدوز\n📝 ${backupName}\n📊 ${formatBytes(stat.size)}\n🕐 ${stat.mtime.toLocaleString('fa-IR')}`;

    await bot.telegram.sendDocument(chatId, inputFile, { caption });
    return { ok: true };
  } catch (error) {
    console.error('Send backup to telegram error:', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * تیک اصلی: هر ۶۰ ثانیه بررسی می‌کند آیا زمان اجرا رسیده است
 */
async function tick() {
  if (running) return; // جلوگیری از اجرای هم‌زمان

  const enabled = await getSettingBool('backup_auto_enabled');
  if (!enabled) return;

  const nextRunStr = await getSetting('backup_next_run_at');
  if (!nextRunStr) {
    // زمان بعدی تنظیم نشده، محاسبه کن
    await updateNextRunTime();
    return;
  }

  const nextRun = new Date(nextRunStr);
  const now = new Date();

  if (now >= nextRun) {
    running = true;
    try {
      const result = await runAutoBackup();
      if (result) {
        // اگر ارسال خودکار به تلگرام فعال باشد، ارسال کن
        const autoSend = await getSettingBool('backup_auto_send');
        if (autoSend) {
          const sendResult = await sendBackupToTelegram(result.name);
          if (sendResult.ok) {
            console.log(`[backup-scheduler] Auto backup sent to Telegram: ${result.name}`);
          } else {
            console.error(`[backup-scheduler] Failed to send auto backup to Telegram: ${sendResult.error}`);
          }
        }
      }
    } finally {
      running = false;
    }
  }
}

/**
 * شروع زمان‌بندی بکاپ خودکار
 */
export function startBackupScheduler() {
  if (timerHandle) {
    console.log('[backup-scheduler] Already running');
    return;
  }

  console.log('[backup-scheduler] Starting backup scheduler (tick every %d ms)', TICK_MS);
  
  // محاسبهٔ اولیهٔ زمان بعدی
  updateNextRunTime().catch((err) => {
    console.error('[backup-scheduler] Failed to compute initial next run:', err);
  });

  timerHandle = setInterval(tick, TICK_MS);
}

/**
 * توقف زمان‌بندی بکاپ خودکار
 */
export function stopBackupScheduler() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
    console.log('[backup-scheduler] Stopped');
  }
}

/**
 * دستی: اجرای فوری بکاپ خودکار (برای تست یا درخواست دستی از پنل)
 */
export async function triggerAutoBackup(): Promise<{ name: string; size: number } | null> {
  return runAutoBackup();
}

/**
 * دریافت وضعیت زمان‌بندی
 */
export async function getScheduleStatus() {
  const enabled = await getSettingBool('backup_auto_enabled');
  const interval = (await getSetting('backup_auto_interval')) || 'daily';
  const customHours = (await getSettingNumber('backup_auto_custom_hours')) || 24;
  const timeStr = (await getSetting('backup_auto_time')) || '03:00';
  const retention = (await getSettingNumber('backup_auto_retention')) || 20;
  const lastRun = (await getSetting('backup_last_run_at')) || '';
  const nextRun = (await getSetting('backup_next_run_at')) || '';

  return {
    enabled,
    interval,
    customHours,
    time: timeStr,
    retention,
    lastRunAt: lastRun,
    nextRunAt: nextRun,
  };
}

/**
 * به‌روزرسانی تنظیمات زمان‌بندی
 */
export async function updateScheduleSettings(settings: {
  enabled?: boolean;
  interval?: string;
  customHours?: number;
  time?: string;
  retention?: number;
}) {
  if (settings.enabled !== undefined) {
    await setSetting('backup_auto_enabled', settings.enabled ? 'true' : 'false');
  }
  if (settings.interval !== undefined) {
    await setSetting('backup_auto_interval', settings.interval);
  }
  if (settings.customHours !== undefined) {
    await setSetting('backup_auto_custom_hours', String(settings.customHours));
  }
  if (settings.time !== undefined) {
    await setSetting('backup_auto_time', settings.time);
  }
  if (settings.retention !== undefined) {
    await setSetting('backup_auto_retention', String(settings.retention));
  }
  
  clearSettingsCache();
  await updateNextRunTime();
}
