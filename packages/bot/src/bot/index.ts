import { Telegraf } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { createBotInstance } from './runtime.js';

interface RunningBot {
  instance: Telegraf;
  token: string;
  username?: string;
  running: boolean;
  launched: boolean;
  error?: string;
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

// ─── Telegram Command Menus ──────────────────
const PRIVATE_COMMANDS = [
  { command: 'start', description: 'شروع ربات و منوی اصلی' },
  { command: 'menu', description: 'منوی اصلی' },
  { command: 'games', description: 'بازی‌ها' },
  { command: 'free', description: 'دریافت کانفیگ رایگان' },
  { command: 'proxy', description: 'دریافت پروکسی' },
  { command: 'points', description: 'امتیازهای من' },
  { command: 'checkin', description: 'امتیاز روزانه' },
  { command: 'referral', description: 'دعوت دوستان' },
  { command: 'support', description: 'پشتیبانی' },
  { command: 'download', description: 'دانلود از اینستاگرام و یوتیوب' },
  { command: 'voice', description: 'تبدیل ویس و ویدیو' },
  { command: 'status', description: 'وضعیت سرورها' },
];

const GROUP_COMMANDS = [
  { command: 'games', description: 'منوی بازی‌های ربات' },
];

async function syncCommandMenus(telegram: any) {
  try {
    // Default scope (fallback)
    await telegram.setMyCommands(PRIVATE_COMMANDS);
    // Private chats
    await telegram.setMyCommands(PRIVATE_COMMANDS, { scope: { type: 'all_private_chats' } });
    // Groups — only /games
    await telegram.setMyCommands(GROUP_COMMANDS, { scope: { type: 'all_group_chats' } });
    // Group admins see the same list
    await telegram.setMyCommands(GROUP_COMMANDS, { scope: { type: 'all_chat_administrators' } });
    console.log('Command menus synced');
  } catch (error: any) {
    console.error('Sync command menus error:', error?.description || error?.message || String(error));
  }
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
  };
  running.set(botId, entry);

  try {
    const me = await withTimeout(entry.instance.telegram.getMe(), 15000, 'getMe');
    entry.username = me.username;
    await prisma.bot.update({ where: { id: botId }, data: { username: me.username } });

    // Register / commands for private chats and groups
    await syncCommandMenus(entry.instance.telegram);

    entry.instance.launch({ dropPendingUpdates: true }).catch((error: any) => {
      entry.running = false;
      entry.error = error?.description || error?.message || String(error);
      console.error(`Bot ${botId} polling stopped:`, entry.error);
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
}

export async function stopAllBots(): Promise<void> {
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
