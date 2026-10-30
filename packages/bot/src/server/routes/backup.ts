import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { clearSettingsCache } from '../../lib/settings.js';
import { clearTextsCache } from '../../lib/texts.js';
import { reloadBots, getBotRuntime } from '../../bot/index.js';

const router = Router();

const BACKUP_DIR = process.env.BACKUP_DIR || '/app/data/backups';
const FORMAT = 'sulduz-backup';
const VERSION = 1;
const MAX_BACKUPS = 20;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const NAME_PATTERN = /^[A-Za-z0-9._-]+\.json$/;

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

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function resolveBackupPath(name: string): string | null {
  if (!NAME_PATTERN.test(name) || path.basename(name) !== name) return null;
  const full = path.join(BACKUP_DIR, name);
  return fs.existsSync(full) ? full : null;
}

function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
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
  ]);

  const data = {
    bots,
    // BigInt cannot be serialized to JSON; keep it as a string and cast back on restore.
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
  };

  const counts: BackupCounts = {};
  for (const key of DATA_KEYS) counts[key] = (data[key] as any[]).length;

  return {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    counts,
    data,
  };
}

async function writeBackup(payload: BackupPayload, prefix = 'backup'): Promise<{ name: string; size: number }> {
  ensureDir();
  const name = `sulduz-${prefix}-${stamp()}.json`;
  const full = path.join(BACKUP_DIR, name);
  const body = JSON.stringify(payload, null, 2);
  fs.writeFileSync(full, body, 'utf8');
  pruneBackups();
  return { name, size: Buffer.byteLength(body, 'utf8') };
}

function pruneBackups() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((file) => NAME_PATTERN.test(file))
    .map((file) => ({ file, mtime: fs.statSync(path.join(BACKUP_DIR, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const stale of files.slice(MAX_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, stale.file));
    } catch {
      // ignore
    }
  }
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resetSequences(tx: any) {
  const tables = [
    'bots',
    'users',
    'config_claims',
    'channels',
    'user_channel_statuses',
    'tickets',
    'downloads',
    'point_transactions',
    'settings',
    'menu_buttons',
    'bot_texts',
    'shop_items',
    'mtproto_proxies',
    'audit_logs',
  ];

  for (const table of tables) {
    await tx.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`
    );
  }
}

function validatePayload(body: any): BackupPayload {
  if (!body || body.format !== FORMAT) {
    throw new Error('فایل بکاپ معتبر نیست (format نامعتبر).');
  }
  if (body.version !== VERSION) {
    throw new Error(`نسخه بکاپ (${body.version}) با این نسخه نرم‌افزار (${VERSION}) سازگار نیست.`);
  }
  if (!body.data || typeof body.data !== 'object') {
    throw new Error('فایل بکاپ داده‌ای ندارد.');
  }
  for (const key of DATA_KEYS) {
    if (!Array.isArray(body.data[key])) {
      throw new Error(`بخش «${key}» در فایل بکاپ پیدا نشد.`);
    }
  }
  return body as BackupPayload;
}

async function applyBackup(payload: BackupPayload) {
  const { data } = payload;

  await prisma.$transaction(
    async (tx) => {
      await tx.user.updateMany({ data: { referredBy: null } });
      await tx.userChannelStatus.deleteMany();
      await tx.configClaim.deleteMany();
      await tx.pointTransaction.deleteMany();
      await tx.download.deleteMany();
      await tx.ticket.deleteMany();
      await tx.user.deleteMany();
      await tx.channel.deleteMany();
      await tx.bot.deleteMany();
      await tx.setting.deleteMany();
      await tx.menuButton.deleteMany();
      await tx.botText.deleteMany();
      await tx.shopItem.deleteMany();
      await tx.mtprotoProxy.deleteMany();
      await tx.auditLog.deleteMany();

      const chunk = 500;
      const insertAll = async (rows: any[], create: (batch: any[]) => Promise<unknown>) => {
        for (let i = 0; i < rows.length; i += chunk) {
          await create(rows.slice(i, i + chunk));
        }
      };

      await insertAll(data.bots, (batch) => tx.bot.createMany({ data: batch }));
      await insertAll(
        data.users.map((user) => ({ ...user, telegramId: BigInt(user.telegramId) })),
        (batch) => tx.user.createMany({ data: batch })
      );
      await insertAll(
        data.channels.map((channel) => ({ ...channel, channelId: BigInt(channel.channelId) })),
        (batch) => tx.channel.createMany({ data: batch })
      );
      await insertAll(data.configClaims, (batch) => tx.configClaim.createMany({ data: batch }));
      await insertAll(data.userChannelStatuses, (batch) =>
        tx.userChannelStatus.createMany({ data: batch })
      );
      await insertAll(data.tickets, (batch) => tx.ticket.createMany({ data: batch }));
      await insertAll(data.downloads, (batch) => tx.download.createMany({ data: batch }));
      await insertAll(data.pointTransactions, (batch) =>
        tx.pointTransaction.createMany({ data: batch })
      );
      await insertAll(data.settings, (batch) => tx.setting.createMany({ data: batch }));
      await insertAll(data.menuButtons, (batch) => tx.menuButton.createMany({ data: batch }));
      await insertAll(data.botTexts, (batch) => tx.botText.createMany({ data: batch }));
      await insertAll(data.shopItems, (batch) => tx.shopItem.createMany({ data: batch }));
      await insertAll(data.mtprotoProxies, (batch) => tx.mtprotoProxy.createMany({ data: batch }));
      await insertAll(data.auditLogs, (batch) => tx.auditLog.createMany({ data: batch }));

      await resetSequences(tx);
    },
    { timeout: 180_000, maxWait: 30_000 }
  );

  clearSettingsCache();
  clearTextsCache();
}

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    ensureDir();
    const backups = fs
      .readdirSync(BACKUP_DIR)
      .filter((file) => NAME_PATTERN.test(file))
      .map((file) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, file));
        return { name: file, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const [users, bots, channels, settings, tickets] = await Promise.all([
      prisma.user.count(),
      prisma.bot.count(),
      prisma.channel.count(),
      prisma.setting.count(),
      prisma.ticket.count(),
    ]);

    res.json({
      backups,
      maxBackups: MAX_BACKUPS,
      stats: { users, bots, channels, settings, tickets },
    });
  } catch (error) {
    console.error('List backups error:', error);
    res.status(500).json({ error: 'خطا در خواندن لیست بکاپ‌ها' });
  }
});

router.post('/', async (_req: AuthRequest, res: Response) => {
  try {
    const payload = await collectData();
    const { name, size } = await writeBackup(payload);
    res.json({ success: true, name, size, counts: payload.counts });
  } catch (error) {
    console.error('Create backup error:', error);
    res.status(500).json({ error: 'خطا در ساخت بکاپ: ' + serializeError(error) });
  }
});

router.get('/:name/download', async (req: AuthRequest, res: Response) => {
  try {
    const full = resolveBackupPath(req.params.name);
    if (!full) return res.status(404).json({ error: 'فایل بکاپ پیدا نشد' });
    res.download(full, req.params.name);
  } catch (error) {
    console.error('Download backup error:', error);
    res.status(500).json({ error: 'خطا در دانلود بکاپ' });
  }
});

router.delete('/:name', async (req: AuthRequest, res: Response) => {
  try {
    const full = resolveBackupPath(req.params.name);
    if (!full) return res.status(404).json({ error: 'فایل بکاپ پیدا نشد' });
    fs.unlinkSync(full);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete backup error:', error);
    res.status(500).json({ error: 'خطا در حذف بکاپ' });
  }
});

router.post('/restore', async (req: AuthRequest, res: Response) => {
  let payload: BackupPayload;

  try {
    const { name, data } = req.body || {};

    if (name) {
      const full = resolveBackupPath(String(name));
      if (!full) return res.status(404).json({ error: 'فایل بکاپ پیدا نشد' });
      payload = validatePayload(JSON.parse(fs.readFileSync(full, 'utf8')));
    } else if (data) {
      if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: 'حجم فایل بکاپ بیش از حد مجاز است' });
      }
      payload = validatePayload(data);
    } else {
      return res.status(400).json({ error: 'فایل بکاپ یا نام بکاپ ارسال نشده است' });
    }
  } catch (error) {
    return res.status(400).json({ error: 'بکاپ قابل خواندن نیست: ' + serializeError(error) });
  }

  try {
    const current = await collectData();
    const safety = await writeBackup(current, 'pre-restore');

    await applyBackup(payload);

    let botsReloaded = true;
    let botError: string | null = null;
    try {
      await reloadBots();
      const activeBots = await prisma.bot.findMany({ where: { isActive: true } });
      const failed = activeBots.find((bot) => getBotRuntime(bot.id).error);
      if (failed) {
        botsReloaded = false;
        botError = `${failed.name}: ${getBotRuntime(failed.id).error}`;
      }
    } catch (error) {
      botsReloaded = false;
      botError = serializeError(error);
      console.error('Reload bots after restore failed:', error);
    }

    res.json({
      success: true,
      restoredCounts: payload.counts,
      safetyBackup: safety.name,
      botsReloaded,
      botError,
    });
  } catch (error) {
    console.error('Restore backup error:', error);
    res.status(500).json({ error: 'خطا در بازگردانی بکاپ: ' + serializeError(error) });
  }
});

export const backupRouter = router;
