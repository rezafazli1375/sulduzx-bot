import { Telegraf } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { createBotInstance } from './runtime.js';
import { syncCommandMenus } from '../lib/bot-commands.js';

interface RunningBot {
  instance: Telegraf;
  token: string;
  username?: string;
  running: boolean;
  launched: boolean;
  error?: string;
  /** تعداد دفعاتی که پشت‌سرهم restart شده — برای backoff */
  restartCount: number;
  /** آخرین بار restart */
  lastRestartAt: number;
}

const running = new Map<number, RunningBot>();
let reloadChain: Promise<void> = Promise.resolve();

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export interface BotRuntimeStatus {
  running: boolean;
  username?: string;
  error?: string;
}

async function ensurePrimaryBot() {
  const count = await prisma.bot.count();
  if (count > 0) return;

  const token = process.env.BOT_TOKEN;
  if (!token) return;

  await prisma.bot.create({
    data: { name: 'ربات اصلی', token, sortOrder: 10 },
  });
  console.log('Primary bot created from BOT_TOKEN');
}

async function stopEntry(entry: RunningBot) {
  if (!entry.launched) return;
  try {
    await entry.instance.stop('reload');
  } catch (error) {
    console.error('Bot stop error:', error);
  }
  entry.launched = false;
  entry.running = false;
}

async function startEntry(botId: number, token: string) {
  const existing = running.get(botId);
  if (existing && existing.token === token && existing.running) return;

  if (existing) {
    await stopEntry(existing);
    running.delete(botId);
  }

  const entry: RunningBot = {
    instance: createBotInstance(botId, token),
    token,
    running: false,
    launched: false,
    restartCount: 0,
    lastRestartAt: 0,
  };
  running.set(botId, entry);

  try {
    const me = await withTimeout(entry.instance.telegram.getMe(), 15000, 'getMe');
    entry.username = me.username;
    await prisma.bot.update({ where: { id: botId }, data: { username: me.username } });

    // Register / commands for private chats and groups (per-bot permissions)
    await syncCommandMenus(entry.instance.telegram, botId);

    entry.instance.launch({ dropPendingUpdates: true }).catch((error: any) => {
      entry.running = false;
      entry.launched = false;
      entry.error = error?.description || error?.message || String(error);
      console.error(`Bot ${botId} polling stopped:`, entry.error);
      // Auto-restart after a delay
      scheduleAutoRestart(botId, entry);
    });

    entry.launched = true;
    entry.running = true;
    console.log(`Bot @${me.username} (id ${botId}) started`);
  } catch (error: any) {
    entry.error = error?.description || error?.message || String(error);
    entry.running = false;
    entry.launched = false;
    console.error(`Bot ${botId} start failed:`, entry.error);
  }
}

/**
 * برنامه‌ریزی راه‌اندازی مجدد خودکار با backoff تصاعدی.
 * اگر ربات بیش از ۵ بار پشت‌سرهم در کمتر از ۱۰ دقیقه restart شود،
 * دیگر خودکار restart نمی‌شود (مشکل جدی‌تری وجود دارد).
 */
function scheduleAutoRestart(botId: number, entry: RunningBot) {
  const now = Date.now();
  // اگر ۱۰ دقیقه از آخرین restart گذشته، شمارنده صفر شود
  if (now - entry.lastRestartAt > 10 * 60 * 1000) {
    entry.restartCount = 0;
  }
  entry.restartCount++;
  entry.lastRestartAt = now;

  // حداکثر ۵ بار restart پشت‌سرهم
  if (entry.restartCount > 5) {
    console.error(
      `Bot ${botId} has restarted ${entry.restartCount} times in quick succession. ` +
      `Auto-restart disabled. Please check the bot settings.`
    );
    return;
  }

  // Backoff: 5s, 10s, 20s, 40s, 80s
  const delay = Math.min(5000 * Math.pow(2, entry.restartCount - 1), 80000);
  console.log(`Bot ${botId} will auto-restart in ${delay / 1000}s (attempt ${entry.restartCount}/5)`);

  setTimeout(async () => {
    const current = running.get(botId);
    if (!current || current !== entry) return; // entry replaced or removed
    if (current.running) return; // already restarted manually

    try {
      console.log(`Auto-restarting bot ${botId}...`);
      await startEntry(botId, current!.token);
    } catch (restartError: any) {
      console.error(`Bot ${botId} auto-restart failed:`, restartError?.message || restartError);
      // Try again
      scheduleAutoRestart(botId, current!);
    }
  }, delay);
}

/**
 * بررسی سلامت دوره‌ای: هر ۶۰ ثانیه ربات‌هایی که متوقف شده‌اند
 * اما isActive=true دارند را دوباره راه‌اندازی می‌کند.
 */
let healthCheckInterval: NodeJS.Timeout | null = null;

function startHealthCheck() {
  if (healthCheckInterval) return;
  healthCheckInterval = setInterval(async () => {
    try {
      const bots = await prisma.bot.findMany({ where: { isActive: true } });
      for (const bot of bots) {
        const entry = running.get(bot.id);
        // اگر ربات فعال باید باشد ولی running=false و خطایی ثبت شده
        if (!entry || (!entry.running && entry.error)) {
          console.log(`Health check: restarting bot ${bot.id} (@${bot.username || 'unknown'})`);
          await startEntry(bot.id, bot.token);
        }
      }
    } catch (err: any) {
      console.error('Health check error:', err?.message || err);
    }
  }, 60_000);
}

function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

async function runReload() {
  await ensurePrimaryBot();

  const bots = await prisma.bot.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });

  const desired = new Map(bots.filter((bot) => bot.isActive).map((bot) => [bot.id, bot]));

  for (const [botId, entry] of Array.from(running.entries())) {
    const target = desired.get(botId);
    if (!target || target.token !== entry.token) {
      await stopEntry(entry);
      running.delete(botId);
      if (target) {
        await startEntry(target.id, target.token);
      }
    }
  }

  for (const bot of desired.values()) {
    await startEntry(bot.id, bot.token);
  }
}

export function reloadBots(): Promise<void> {
  reloadChain = reloadChain.then(runReload).catch((error) => {
    console.error('Reload bots error:', error);
  });
  return reloadChain;
}

export async function startBots(): Promise<void> {
  await reloadBots();
  startHealthCheck();
}

export async function stopAllBots(): Promise<void> {
  stopHealthCheck();
  for (const entry of running.values()) {
    await stopEntry(entry);
  }
  running.clear();
}

export function getBotRuntime(botId: number): BotRuntimeStatus {
  const entry = running.get(botId);
  if (!entry) return { running: false };
  return { running: entry.running, username: entry.username, error: entry.error };
}

export function getBotInstance(botId: number): Telegraf | undefined {
  const entry = running.get(botId);
  return entry?.running ? entry.instance : undefined;
}

/**
 * بعد از تغییر دسترسی‌های یک ربات در پنل، منوی دستورهای تلگرام همان ربات از نو
 * ساخته می‌شود تا دستوری که اجازه ندارد در لیست / نماند.
 */
export async function resyncBotCommands(botId: number): Promise<boolean> {
  const entry = running.get(botId);
  if (!entry?.running) return false;
  await syncCommandMenus(entry.instance.telegram, botId);
  return true;
}

export function getFirstRunningBot(): Telegraf | undefined {
  for (const entry of running.values()) {
    if (entry.running) return entry.instance;
  }
  return undefined;
}

export async function sendMessageToTelegramId(
  botId: number,
  telegramId: string | bigint,
  text: string,
  extra?: Record<string, any>
): Promise<void> {
  const bot = getBotInstance(botId);
  if (!bot) throw new Error('ربات مربوطه فعال نیست');
  await bot.telegram.sendMessage(telegramId.toString(), text, extra);
}
