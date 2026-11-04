import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './prisma.js';

// ─── کتابخانهٔ موزیک ─────────────────────────
// هر آهنگ می‌تواند دو منبع داشته باشد:
//  • fileId  → شناسهٔ فایل تلگرام. مخصوص همان ربات است و تا ابد معتبر می‌ماند؛
//    پخش از روی آن هیچ دانلودی ندارد و سریع‌ترین راه است. وقتی کاربری آهنگی را
//    در گروه می‌فرستد، همین حالا در دسترس است؛ وقتی آهنگ از فایل محلی پخش
//    می‌شود، تلگرام file_id را برمی‌گرداند و برای دفعات بعد ذخیره می‌شود.
//  • filePath → کپی محلی روی volume مشترک (/app/data/music). برای آهنگی که از
//    پنل آپلود می‌شود تنها منبع اولیه است و برای استریم در ویس‌کال (سرویس
//    MTProto که فایل را با ffmpeg می‌خواند) لازم است.
export const MUSIC_DIR =
  process.env.MUSIC_DIR || path.join(process.cwd(), 'data', 'music');

/** حجم پیش‌فرض مجاز برای آهنگ آپلودی (مگابایت)؛ از تنظیم music_max_mb قابل تغییر است */
export const MUSIC_DEFAULT_MAX_MB = 25;

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wav']);

const MIME_TO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/m4a': 'm4a',
};

export function botMusicDir(botId: number): string {
  return path.join(MUSIC_DIR, String(botId));
}

export function ensureBotMusicDir(botId: number): string {
  const dir = botMusicDir(botId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** پسوند امن از نام فایل یا نوع MIME؛ پیش‌فرض mp3 */
export function audioExtension(mimeType?: string | null, fileName?: string | null): string {
  const fromName = /\.([a-z0-9]{2,4})$/i.exec(fileName || '')?.[1]?.toLowerCase();
  if (fromName && AUDIO_EXTENSIONS.has(fromName)) return fromName;
  const fromMime = MIME_TO_EXT[(mimeType || '').toLowerCase()];
  if (fromMime && AUDIO_EXTENSIONS.has(fromMime)) return fromMime;
  return 'mp3';
}

export function isAudioFileName(fileName?: string | null, mimeType?: string | null): boolean {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('audio/')) return true;
  return AUDIO_EXTENSIONS.has(
    /\.([a-z0-9]{2,4})$/i.exec(fileName || '')?.[1]?.toLowerCase() || ''
  );
}

/** ذخیرهٔ فایل آهنگ روی دیسک و برگرداندن مسیر مطلق */
export function saveAudioFile(botId: number, buffer: Buffer, ext: string): string {
  const dir = ensureBotMusicDir(botId);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeExt = AUDIO_EXTENSIONS.has(ext) ? ext : 'mp3';
  const file = path.join(dir, `${unique}.${safeExt}`);
  fs.writeFileSync(file, buffer);
  return file;
}

/** حذف فایل از دیسک؛ فقط فایل‌های داخل پوشهٔ موزیک (برای اینکه اشتباهی چیزی پاک نشود) */
export function removeAudioFile(filePath?: string | null): boolean {
  if (!filePath) return false;
  const insideMusicDir = path.resolve(filePath).startsWith(path.resolve(MUSIC_DIR) + path.sep);
  if (!insideMusicDir) return false;
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch (error) {
    console.error('Remove music file error:', error);
    return false;
  }
}

export function audioFileExists(filePath?: string | null): boolean {
  if (!filePath) return false;
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** سقف دانلود فایل از تلگرام با Bot API (بیشترباشد file_path کار نمی‌کند) */
export const BOT_API_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

/**
 * فایل آهنگ را از تلگرام روی دیسک می‌آورد تا سرویس ویس‌کال بتواند آن را
 * استریم کند. file_id مخصوص همان ربات است و حساب کاربری تلگرام نمی‌تواند با
 * آن فایل را بخواند؛ پس برای پخش در ویس‌کال یک کپی محلی لازم است.
 * مسیر فایل را برمی‌گرداند و در مسیر جدید null (با دلیل در لاگ).
 */
export async function downloadToLibrary(
  telegram: any,
  fileId: string,
  botId: number,
  mimeType?: string | null,
  fileName?: string | null
): Promise<string | null> {
  if (!telegram?.getFile || !telegram?.downloadFile) return null;
  let remotePath = '';
  let size = 0;
  try {
    const file = await telegram.getFile(fileId);
    remotePath = String(file?.file_path || '');
    size = Number(file?.file_size || 0);
  } catch (error: any) {
    console.error('Music getFile error:', error?.description || error?.message || error);
    return null;
  }
  if (!remotePath) return null;
  if (size > BOT_API_DOWNLOAD_MAX_BYTES) {
    console.warn('Music file too large for Bot API download:', size);
    return null;
  }
  try {
    const stream: any = await telegram.downloadFile(remotePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) return null;
    if (buffer.length > BOT_API_DOWNLOAD_MAX_BYTES) {
      console.warn('Music file grew past the download limit:', buffer.length);
      return null;
    }
    return saveAudioFile(botId, buffer, audioExtension(mimeType, fileName || remotePath));
  } catch (error: any) {
    console.error('Music download error:', error?.description || error?.message || error);
    return null;
  }
}

/**
 * آدرس فایل برای سرویس ویس‌کال: همان فایل، اما از دید آن کانتینر.
 * (کتابخانه در ربات /app/data/music و در سرویس /app/music دیده می‌شود؛
 * سرویس خودش این نگاشت را می‌شناسد.)
 */
export function libraryRelativePath(filePath: string): string {
  const inside = path.resolve(filePath);
  const root = path.resolve(MUSIC_DIR);
  if (inside.startsWith(root + path.sep)) return path.relative(root, inside);
  return inside;
}

/**
 * انتخاب تصادفی یک آهنگ از کتابخانهٔ ربات.
 * `exclude` شناسهٔ آهنگ‌هایی است که اخیراً در همین گروه پخش شده‌اند تا پشت‌سرهم
 * تکرار نشود؛ اگر همهٔ آهنگ‌ها excluded باشند، از کل کتابخانه انتخاب می‌شود.
 */
export async function pickRandomTrack(botId: number, exclude: number[] = []) {
  const active = { botId, isActive: true };
  let pool = await prisma.musicTrack.findMany({
    where: { ...active, id: { notIn: exclude } },
    select: { id: true },
  });
  if (pool.length === 0) pool = await prisma.musicTrack.findMany({ where: active, select: { id: true } });
  if (pool.length === 0) return null;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return prisma.musicTrack.findUnique({ where: { id: chosen.id } });
}

export async function countActiveTracks(botId: number): Promise<number> {
  return prisma.musicTrack.count({ where: { botId, isActive: true } });
}

/** ثانیه → ۳:۲۰ (برای نمایش در کارت پخش) */
export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** حجم → متن خوانا */
export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} مگابایت`;
  return `${Math.max(1, Math.round(bytes / 1024))} کیلوبایت`;
}

/**
 * نام‌گذاری آهنگ از پیام تلگرام: کپشن، نام فایل یا نام هنرمند.
 * برگردانندهٔ { title, artist, fileName, mimeType, fileId, duration, fileSize, kind }
 */
export function readAudioFromMessage(msg: any): {
  fileId: string;
  kind: 'audio' | 'document' | 'voice';
  title: string;
  artist?: string;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  fileSize?: number;
} | null {
  if (!msg) return null;

  if (msg.audio?.file_id) {
    const a = msg.audio;
    return {
      fileId: a.file_id,
      kind: 'audio',
      title: cleanTitle(a.file_name || msg.caption || 'آهنگ'),
      artist: a.performer || undefined,
      fileName: a.file_name || undefined,
      mimeType: a.mime_type || 'audio/mpeg',
      duration: a.duration || undefined,
      fileSize: a.file_size || undefined,
    };
  }

  if (msg.voice?.file_id) {
    const v = msg.voice;
    return {
      fileId: v.file_id,
      kind: 'voice',
      title: cleanTitle(msg.caption || 'ویس'),
      fileName: undefined,
      mimeType: v.mime_type || 'audio/ogg',
      duration: v.duration || undefined,
      fileSize: v.file_size || undefined,
    };
  }

  if (msg.document?.file_id) {
    const d = msg.document;
    if (!isAudioFileName(d.file_name, d.mime_type)) return null;
    return {
      fileId: d.file_id,
      kind: 'document',
      title: cleanTitle(stripExtension(d.file_name) || msg.caption || 'آهنگ'),
      fileName: d.file_name || undefined,
      mimeType: d.mime_type || 'audio/mpeg',
      fileSize: d.file_size || undefined,
    };
  }

  if (msg.video?.file_id && !msg.video.file_name) {
    // ویدیویی که فقط صدا دارد (مثلاً موزیک‌ویدیوی کوتاه) پخش نمی‌شود
    return null;
  }

  return null;
}

function stripExtension(name?: string | null): string {
  return (name || '').replace(/\.[a-z0-9]{2,4}$/i, '').trim();
}

function cleanTitle(value?: string | null): string {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'آهنگ بدون نام';
  return text.slice(0, 120);
}

export { cleanTitle as cleanMusicTitle };
