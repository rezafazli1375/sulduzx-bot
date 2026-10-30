import { Prisma, SettingType } from '@prisma/client';
import { prisma } from './prisma.js';

const cache = new Map<string, { value: string; expires: number }>();
const CACHE_TTL = 60_000;

export async function getSetting(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  const setting = await prisma.setting.findUnique({ where: { key } });
  if (!setting) return null;

  cache.set(key, { value: setting.value, expires: Date.now() + CACHE_TTL });
  return setting.value;
}

export async function getSettingBool(key: string): Promise<boolean> {
  const val = await getSetting(key);
  return val === 'true';
}

export async function getSettingNumber(key: string): Promise<number> {
  const val = await getSetting(key);
  return val ? parseInt(val, 10) : 0;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value, type: 'STRING' },
  });
  cache.delete(key);
}

export async function getAllSettings() {
  return prisma.setting.findMany({ orderBy: { key: 'asc' } });
}

const REQUIRED_DEFAULTS: Array<{
  key: string;
  value: string;
  type: SettingType;
  description: string;
}> = [
  {
    key: 'word_pdf_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'تبدیل Word به PDF فعال',
  },
  {
    key: 'word_pdf_max_mb',
    value: '20',
    type: 'NUMBER',
    description: 'حداکثر حجم فایل Word (مگابایت)',
  },
  {
    key: 'video_mp3_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'تبدیل ویدیو به MP3 فعال',
  },
  {
    key: 'video_mp3_max_mb',
    value: '20',
    type: 'NUMBER',
    description: 'حداکثر حجم ویدیو (مگابایت)',
  },
];

export async function ensureDefaultSettings(): Promise<void> {
  let created = false;

  for (const setting of REQUIRED_DEFAULTS) {
    const existing = await prisma.setting.findUnique({ where: { key: setting.key } });
    if (existing) continue;
    await prisma.setting.create({ data: setting });
    created = true;
  }

  if (created) clearSettingsCache();
}

export function clearSettingsCache(): void {
  cache.clear();
}
