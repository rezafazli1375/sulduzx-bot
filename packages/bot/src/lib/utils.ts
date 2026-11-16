import crypto from 'crypto';

export function generateReferralCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export function generateUUID(): string {
  return crypto.randomUUID();
}

export function generateShortId(length = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatRemainingBytes(total: number, used: number): string {
  const remaining = Math.max(0, total - used);
  return formatBytes(remaining);
}

export function daysUntil(date: Date): number {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function isExpired(date: Date): boolean {
  return date.getTime() < Date.now();
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function gbToBytes(gb: number): number {
  return gb * 1024 * 1024 * 1024;
}

export function bytesToGb(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
}

// ─── ابزار «روزانه» ───────────────────────────
// نسخهٔ ۲٫۰٫۰ با حذف کلمه‌یاب به lib منتقل شد؛ فال روز هم همین‌ها را صدا می‌زند.

/** کلید روز بر اساس تاریخ تهران (+۳:۳۰) — نه نیمه‌شب سرور */
export function tehranDateKey(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 3.5 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** عددیِ قطعی از یک رشته: همان ورودی همیشه همان خروجی را می‌دهد */
export function stableHash(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** انتخاب قطعی یک عضو از مجموعه بر اساس کلید (روز، کاربر+روز و…) */
export function pickBySeed<T>(pool: T[], seed: string): T | null {
  if (pool.length === 0) return null;
  return pool[stableHash(seed) % pool.length];
}

/**
 * فارسی‌کردن رقم‌های یک عدد و جداکردن هزارگان با «،».
 * متن‌های ربات همه فارسی‌اند، پس عدد لاتین وسط متن خواندن را سخت می‌کند.
 */
export function faNum(value: number): string {
  const digits = '۰۱۲۳۴۵۶۷۸۹';
  return Math.trunc(value)
    .toLocaleString('en-US')
    .replace(/[0-9]/g, (d) => digits[Number(d)]);
}
