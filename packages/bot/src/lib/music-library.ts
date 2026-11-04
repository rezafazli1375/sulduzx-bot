import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from './prisma.js';

const execFileAsync = promisify(execFile);

// ─── کتابخانهٔ موزیک ─────────────────────────
// این کتابخانه **مشترک** است: هیچ آهنگی به یک ربات نمی‌چسبد. هر رباتی که در پنل
// ثبت و فعال باشد از همان فهرست آهنگ‌ها پخش می‌کند.
//
// دلیلش این است که file_id تلگرام فقط برای همان رباتی معتبر است که فایل را
// گرفته؛ پس منبع اصلی، **فایل محلی روی volume** است. ربات موقع پخش همان فایل
// را به قالب ویس (OGG/Opus) تبدیل می‌کند تا تلگرامش را به‌شکل ویس نشان دهد.
// خروجی تبدیل برای هر آهنگ یک‌بار روی دیسک می‌ماند و به درد همهٔ ربات‌ها
// می‌خورد؛ file_id ویسِ ساخته‌شده فقط در حافظهٔ پروسه و فقط برای همان ربات نگه
// داشته می‌شود (چون بین ربات‌ها قابل استفاده نیست).
export const MUSIC_DIR =
  process.env.MUSIC_DIR || path.join(process.cwd(), 'data', 'music');

/** فایل اصلی هر آهنگ */
export const TRACKS_DIR = path.join(MUSIC_DIR, 'tracks');
/** خروجی تبدیل‌شده به ویس (OGG/Opus) */
export const VOICE_CACHE_DIR = path.join(MUSIC_DIR, 'voice');

/** حجم پیش‌فرض مجاز برای آهنگ (مگابایت)؛ از تنظیم music_max_mb قابل تغییر است */
export const MUSIC_DEFAULT_MAX_MB = 25;

/** سقف دانلود فایل از تلگرام با Bot API (بیشترباشد file_path کار نمی‌کند) */
export const BOT_API_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

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

function ensureDir(dir: string): string {
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

/** ذخیرهٔ فایل آهنگ در کتابخانهٔ مشترک و برگرداندن مسیر مطلق */
export function saveAudioFile(buffer: Buffer, ext: string): string {
  const dir = ensureDir(TRACKS_DIR);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeExt = AUDIO_EXTENSIONS.has(ext) ? ext : 'mp3';
  const file = path.join(dir, `${unique}.${safeExt}`);
  fs.writeFileSync(file, buffer);
  return file;
}

/** مسیر فایل ویسِ تبدیل‌شدهٔ یک آهنگ (خروجی ffmpeg) */
export function voiceCachePath(trackId: number): string {
  return path.join(VOICE_CACHE_DIR, `${trackId}.ogg`);
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

/** فایل ویس تبدیل‌شدهٔ یک آهنگ هم پاک می‌شود تا بی‌استفاده روی دیسک نماند */
export function removeVoiceCache(trackId: number): boolean {
  const file = voiceCachePath(trackId);
  if (!file.startsWith(path.resolve(VOICE_CACHE_DIR) + path.sep)) return false;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch (error) {
    console.error('Remove voice cache error:', error);
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

/**
 * فایل آهنگ را از تلگرام به کتابخانهٔ مشترک می‌آورد.
 * آهنگی که کاربر در گروه فرستاده فقط file_id دارد و آن file_id هم فقط به همان
 * ربات می‌چسد؛ برای اینکه بقیهٔ ربات‌ها هم بتوانند آن را پخش کنند، یک‌بار
 * دانلود و در کتابخانه ذخیره می‌شود. مسیر فایل برمی‌گرداند و در خطا null
 * (دلیلش در لاگ می‌آید).
 */
export async function downloadToLibrary(
  telegram: any,
  fileId: string,
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
    return saveAudioFile(buffer, audioExtension(mimeType, fileName || remotePath));
  } catch (error: any) {
    console.error('Music download error:', error?.description || error?.message || error);
    return null;
  }
}

/**
 * آهنگ → فایل ویس (OGG/Opus، تک‌کاناله، ۴۸ کیلوهرتز) که تلگرام آن را ویس
 * نشان می‌دهد. خروجی برای هر آهنگ روی دیسک می‌ماند و اگر فایل اصلی تازه‌تر از
 * آن باشد، دوباره ساخته می‌شود.
 */
export async function toVoiceFile(track: {
  id: number;
  filePath: string;
}): Promise<string | null> {
  if (!audioFileExists(track.filePath)) return null;
  const output = voiceCachePath(track.id);
  ensureDir(VOICE_CACHE_DIR);

  try {
    const sourceMtime = fs.statSync(track.filePath).mtimeMs;
    if (fs.existsSync(output)) {
      const cached = fs.statSync(output);
      if (cached.size > 0 && cached.mtimeMs >= sourceMtime) return output;
    }
  } catch {
    /* اگر وضعیت دیسک خوانده نشد، از نو ساخته می‌شود */
  }

  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        track.filePath,
        '-vn',
        '-c:a',
        'libopus',
        '-b:a',
        '64k',
        '-ar',
        '48000',
        '-ac',
        '1',
        output,
      ],
      { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const stats = fs.statSync(output);
    if (stats.size === 0) return null;
    return output;
  } catch (error: any) {
    console.error('Music voice convert error:', error?.message || error);
    try {
      fs.rmSync(output, { force: true });
    } catch {
      /* بی‌خطر */
    }
    return null;
  }
}

/**
 * انتخاب تصادفی یک آهنگ از کتابخانهٔ مشترک.
 * `exclude` شناسهٔ آهنگ‌هایی است که اخیراً در همین گروه پخش شده‌اند (تازه‌ترین
 * اول) تا پشت‌سرهم تکرار نشود. اگر کتابخانه از این فهرست کوچک‌تر باشد، به‌اندازهٔ
 * «یکی کمتر از تعداد آهنگ‌های فعال» حذف می‌شود؛ این‌طوری در کتابخانهٔ کم‌آهنگ هم
 * آهنگِ همین‌الفرصخشده دوباره انتخاب نمی‌شود و انتخاب هیچ‌وقت به بن‌بست نمی‌خورد.
 */
export async function pickRandomTrack(exclude: number[] = []) {
  const active = await prisma.musicTrack.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  if (active.length === 0) return null;

  const activeIds = new Set(active.map((track) => track.id));
  const limit = Math.max(0, Math.min(exclude.length, active.length - 1));
  const skip = new Set(exclude.filter((id) => activeIds.has(id)).slice(0, limit));
  const pool = active.filter((track) => !skip.has(track.id));

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return prisma.musicTrack.findUnique({ where: { id: chosen.id } });
}

export async function countActiveTracks(): Promise<number> {
  return prisma.musicTrack.count({ where: { isActive: true } });
}

/** ثانیه → ۳:۲۰ */
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
 * برگردانندهٔ { fileId, title, artist, fileName, mimeType, duration, fileSize }
 */
export function readAudioFromMessage(msg: any): {
  fileId: string;
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
      title: cleanTitle(stripExtension(a.file_name) || msg.caption || 'آهنگ'),
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
