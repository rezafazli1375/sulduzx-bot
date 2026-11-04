import fs from 'node:fs';
import { Context } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { getSettingBool, getSettingNumber } from '../lib/settings.js';
import { getBotId } from '../lib/bot-context.js';
import { isFeatureAllowed } from '../lib/bot-access.js';
import {
  audioFileExists,
  BOT_API_DOWNLOAD_MAX_BYTES,
  cleanMusicTitle,
  downloadToLibrary,
  MUSIC_DEFAULT_MAX_MB,
  pickRandomTrack,
  readAudioFromMessage,
  toVoiceFile,
} from '../lib/music-library.js';

// ─── پخش‌کنندهٔ موزیک گروه ────────────────────
// خواستهٔ کارفرما: ربات آهنگ را **تصادفی** انتخاب کند و در گروه **به‌شکل ویس**
// بفرستد؛ روی همان ویس نام آهنگ نوشته شود و زیرش آیدی خود ربات تگ شود.
// هیچ پیام متنی اضافه، هیچ کارتی و هیچ دکمهٔ «آهنگ بعدی/توقف» ارسال نمی‌شود.
//
// تنها پیام‌های متنی، پیام‌های خطا هستند (کتابخانه خالی، فایل موجود نیست،
// بخش موزیک خاموش) و آن‌ها هم ۱۰ ثانیه بعد خودکار پاک می‌شوند تا گروه شلوغ
// نماند. خودِ ویس در گروه می‌ماند؛ پاک‌کردن آنچه کاربر گوش می‌دهد درست نیست.
//
// کتابخانهٔ آهنگ‌ها بین همهٔ ربات‌ها مشترک است (جدول music_tracks به رباتی
// وابسته نیست). فایلی که کاربر در گروه می‌فرستد یک‌بار دانلود و در کتابخانه
// ذخیره می‌شود تا بقیهٔ ربات‌ها هم بتوانند از آن استفاده کنند؛ چون file_id
// تلگرام فقط برای رباتِ گیرنده معتبر است.

/** پیام‌های خطا چند ثانیه در گروه می‌مانند */
export const MUSIC_NOTICE_TTL_MS = 10_000;

/** چند آهنگٔ اخیر در یک گروه پخش نشوند تا تکرار پشت‌سرهم نداشته باشیم */
const MAX_RECENT = 6;
/** آهنگی که مدت آن معلوم نیست، حداکثر ۱۰ دقیقه «در حال پخش» می‌ماند */
const UNKNOWN_DURATION_MS = 10 * 60_000;
/** کمی بازگشت برای بستن رکورد پخش بعد از پایان آهنگ */
const LEDGER_GRACE_MS = 30_000;
/** خاطرهٔ تکرارهای یک گروه بی‌کار بعد از این مدت فراموش می‌شود */
const IDLE_MEMORY_MS = 2 * 60 * 60_000;

interface GroupMemory {
  recent: number[];
  lastUsedAt: number;
}

const memories = new Map<string, GroupMemory>();

/**
 * file_id ویسِ تبدیل‌شده، به‌ازای (ربات، آهنگ). این شناسه فقط برای همان ربات
 * کار می‌کند، پس در حافظهٔ پروسه نگه داشته می‌شود و در دیتابیس مشترک ذخیره
 * نمی‌شود؛ با ری‌استارت شدن ربات، آهنگ دوباره آپلود می‌شود.
 */
const voiceIds = new Map<string, string>();

/** رکوردهای بازِ پخش و تایمر بستنشان */
const openPlays = new Map<number, NodeJS.Timeout>();

const usernameCache = new Map<number, string>();

function keyOf(botId: number, chatId: number): string {
  return `${botId}:${chatId}`;
}

function memoryOf(botId: number, chatId: number): GroupMemory {
  const key = keyOf(botId, chatId);
  let memory = memories.get(key);
  if (!memory) {
    memory = { recent: [], lastUsedAt: Date.now() };
    memories.set(key, memory);
  }
  memory.lastUsedAt = Date.now();
  return memory;
}

/** برای تست/عیب‌یابی: آخرین آهنگ‌های پخش‌شده در یک گروه */
export function recentTracksOf(botId: number, chatId: number): number[] {
  return [...(memories.get(keyOf(botId, chatId))?.recent ?? [])];
}

/** برای تست/عیب‌یابی: عدد حافظه‌های گروهی باز */
export function musicMemoryCount(): number {
  return memories.size;
}

/**
 * آیدی ربات برای خط دوم کپشن. ردیف خودِ ربات در دیتابیس username را دارد
 * (هنگام بالا آمدن ذخیره می‌شود)؛ اگر نبود از تلگرام پرسیده می‌شود و در حافظه
 * می‌ماند تا هر پخش یک صدای API اضافه نشود.
 */
async function botUsername(botId: number, telegram: any): Promise<string> {
  const cached = usernameCache.get(botId);
  if (cached) return cached;

  const bot = await prisma.bot
    .findUnique({ where: { id: botId }, select: { username: true } })
    .catch(() => null);
  const fromDb = String(bot?.username || '').replace(/^@/, '');
  if (fromDb) {
    usernameCache.set(botId, fromDb);
    return fromDb;
  }

  const me = await telegram.getMe().catch(() => null);
  const username = String(me?.username || '').replace(/^@/, '');
  if (username) usernameCache.set(botId, username);
  return username;
}

/**
 * کپشن ویس: خط اول نام آهنگ، خط دوم آیدی خود ربات.
 * (تلگرام روی پیام صوتی اجازهٔ کپشن می‌دهد و همین دو خط نمایش داده می‌شود.)
 */
export async function musicCaption(botId: number, telegram: any, title: string): Promise<string> {
  const username = await botUsername(botId, telegram);
  return username ? `🎵 ${title}\n🤖 @${username}` : `🎵 ${title}`;
}

/**
 * پیام کوتاه خطا در گروه؛ چند ثانیه بعد پاک می‌شود تا گروه شلوغ نماند.
 * خودِ ویس هرگز پاک نمی‌شود — کاربر دارد به آن گوش می‌دهد.
 */
async function notify(ctx: Context, text: string): Promise<void> {
  const chatId = ctx.chat?.id;
  if (typeof chatId !== 'number') return;
  try {
    const sent: any = await ctx.reply(text);
    const messageId = typeof sent?.message_id === 'number' ? sent.message_id : undefined;
    if (typeof messageId !== 'number') return;
    const timer = setTimeout(() => {
      notices.delete(timer);
      ctx.telegram.deleteMessage(chatId, messageId).catch(() => undefined);
    }, MUSIC_NOTICE_TTL_MS);
    timer.unref?.();
    notices.add(timer);
  } catch {
    /* ربات اجازهٔ فرستادن یا حذف پیام ندارد */
  }
}

/** تایمرهای در انتظار حذف پیام (برای شمارش در تست و پاک‌سازی) */
const notices = new Set<NodeJS.Timeout>();

/** بستن رکورد پخش وقتی مدت آهنگ تمام شد */
function scheduleLedgerClose(playId: number, durationMs: number): void {
  const timer = setTimeout(() => {
    openPlays.delete(playId);
    prisma.musicPlay
      .update({ where: { id: playId }, data: { status: 'FINISHED', endedAt: new Date() } })
      .catch(() => undefined);
  }, durationMs + LEDGER_GRACE_MS);
  timer.unref?.();
  openPlays.set(playId, timer);
}

/**
 * رکورد پخش می‌سازد. MusicPlay به جدول گروه‌ها وابسته (FK) است؛ اگر گروه هنوز
 * در آن جدول نبود — مثلاً پخشی که از پنل برای گروهی آغاز می‌شود که ربات پیامی
 * در آن ندیده — یک سطر برای گروه ساخته و یک بار دیگر تلاش می‌شود، تا هیچ
 * پخشی از آمار پنل جا نماند.
 */
export async function registerMusicPlay(input: {
  trackId: number;
  botId: number;
  chatId: number | bigint;
  status?: 'PLAYING' | 'FINISHED' | 'STOPPED' | 'FAILED';
  requestId?: bigint | number | null;
  requestName?: string | null;
  messageId?: bigint | number | null;
  endedAt?: Date;
}): Promise<{ id: number } | null> {
  const chatId = BigInt(input.chatId);
  const data = {
    trackId: input.trackId,
    botId: input.botId,
    chatId,
    requestId: input.requestId == null ? null : BigInt(input.requestId),
    requestName: input.requestName ?? null,
    messageId: input.messageId == null ? null : BigInt(input.messageId),
    status: input.status ?? 'PLAYING',
    ...(input.endedAt ? { endedAt: input.endedAt } : {}),
  };

  const first = await prisma.musicPlay.create({ data }).catch(() => null);
  if (first) return first;

  await prisma.groupChat
    .upsert({
      where: { botId_chatId: { botId: input.botId, chatId } },
      create: { botId: input.botId, chatId, chatType: 'supergroup', isJoined: true },
      update: { isJoined: true, leftAt: null },
    })
    .catch(() => undefined);

  return prisma.musicPlay
    .create({ data })
    .catch((error) => {
      console.error('MusicPlay create error:', error?.message || error);
      return null;
    });
}

export interface SendResult {
  ok: boolean;
  messageId?: number;
  reason?: string;
}

/**
 * یک آهنگ را به‌شکل ویس در گروه می‌فرستد.
 * فایل اصلی (mp3/m4a/…) با ffmpeg به OGG/Opus تبدیل می‌شود — قالبی که تلگرام
 * آن را «ویس» نشان می‌دهد — و برای آهنگ‌های بعدی همان ربات از file_id کش‌شده
 * استفاده می‌کند تا دوباره آپلود نشود.
 */
export async function sendTrackAsVoice(input: {
  telegram: any;
  botId: number;
  chatId: number;
  track: { id: number; title: string; filePath: string; duration: number | null };
  requestId?: number | bigint | null;
  requestName?: string | null;
}): Promise<SendResult> {
  const { telegram, botId, chatId, track } = input;
  const cacheKey = `${botId}:${track.id}`;
  const caption = await musicCaption(botId, telegram, track.title);
  const extra: any = { caption, disable_notification: true };
  if (track.duration && track.duration > 0) extra.duration = track.duration;

  let sent: any;
  const cachedFileId = voiceIds.get(cacheKey);

  if (cachedFileId) {
    try {
      sent = await telegram.sendVoice(chatId, cachedFileId, extra);
    } catch (error: any) {
      // file_id باطل شده (مثلاً فایل از دیسک پاک شده) → از کش بیرون، پایین‌تر
      // از روی فایل اصلی دوباره فرستاده می‌شود
      console.error('Music cached voice error:', error?.description || error?.message || error);
      voiceIds.delete(cacheKey);
      sent = null;
    }
  }

  if (!sent) {
    if (!audioFileExists(track.filePath)) {
      return { ok: false, reason: 'فایل این آهنگ روی سرور نیست؛ از پنل دوباره آپلودش کنید.' };
    }
    const voiceFile = await toVoiceFile({ id: track.id, filePath: track.filePath });
    if (!voiceFile) {
      return { ok: false, reason: 'این آهنگ به قالب ویس تبدیل نشد (فرمت فایل پشتیبانی نمی‌شود).' };
    }
    try {
      sent = await telegram.sendVoice(
        chatId,
        { source: fs.createReadStream(voiceFile), filename: `${track.id}.ogg` },
        extra
      );
    } catch (error: any) {
      console.error(
        'Music send error:',
        error?.description || error?.message || String(error)
      );
      return {
        ok: false,
        reason: `تلگرام این ویس را نپذیرفت: ${error?.description || error?.message || 'خطای ناشناخته'}`,
      };
    }
    const fileId = sent?.voice?.file_id;
    if (typeof fileId === 'string' && fileId) voiceIds.set(cacheKey, fileId);
  }

  const messageId = typeof sent?.message_id === 'number' ? sent.message_id : undefined;

  await prisma.musicTrack
    .update({ where: { id: track.id }, data: { playCount: { increment: 1 } } })
    .catch(() => undefined);

  const play = await registerMusicPlay({
    trackId: track.id,
    botId,
    chatId,
    requestId: input.requestId == null ? null : BigInt(input.requestId),
    requestName: input.requestName ?? null,
    messageId: messageId ?? null,
    status: 'PLAYING',
  });

  if (play) {
    const durationMs =
      track.duration && track.duration > 0 ? track.duration * 1000 : UNKNOWN_DURATION_MS;
    scheduleLedgerClose(play.id, durationMs);
  }

  // خاطرهٔ تکرار: آهنگ‌های اخیر در همین گروه دوباره انتخاب نشوند
  const memory = memoryOf(botId, chatId);
  memory.recent = [track.id, ...memory.recent.filter((id) => id !== track.id)].slice(0, MAX_RECENT);

  return { ok: true, messageId };
}

/** آیا پخش موزیک برای این ربات و این کاربر آزاد است؟ (تنظیم سراسری + دسترسی ربات) */
async function musicAllowed(ctx: Context): Promise<boolean> {
  const botId = getBotId(ctx);
  if (!(await getSettingBool('music_enabled'))) {
    await notify(ctx, '🎵 بخش پخش موزیک در این ربات غیرفعال است. از پنل، بخش تنظیمات فعالش کنید.');
    return false;
  }
  if (!(await isFeatureAllowed(botId, 'music'))) {
    await notify(ctx, '🎵 پخش موزیک برای این ربات در پنل غیرفعال شده است.');
    return false;
  }
  return true;
}

/**
 * یک آهنگ تصادفی از کتابخانهٔ مشترک انتخاب و به‌شکل ویس فرستاده می‌شود.
 * اگر آهنگ اول قابل پخش نبود، یک آهنگ دیگر امتحان می‌شود.
 */
export async function playRandomTrack(ctx: Context): Promise<boolean> {
  const chatId = ctx.chat?.id;
  if (typeof chatId !== 'number') return false;
  const botId = getBotId(ctx);
  const memory = memoryOf(botId, chatId);

  const track = await pickRandomTrack(memory.recent);
  if (!track) {
    await notify(
      ctx,
      '🎵 کتابخانهٔ موزیک خالی است.\n\nاز پنل، بخش «موزیک» آهنگ آپلود کنید یا فایل آهنگ را در همین گروه بفرستید و در کپشن بنویسید «پخش».'
    );
    return false;
  }

  const first = await sendTrackAsVoice({
    telegram: ctx.telegram,
    botId,
    chatId,
    track,
    requestId: ctx.from?.id ?? null,
    requestName: ctx.from?.first_name || ctx.from?.username || null,
  });
  if (first.ok) return true;

  console.error('Music play attempt failed:', first.reason);
  // آهنگی که پخش نشد اولِ فهرست حذف است، پس هیچ‌وقت دوباره انتخاب نمی‌شود
  const backup = await pickRandomTrack([track.id, ...memory.recent]);
  if (backup && backup.id !== track.id) {
    const second = await sendTrackAsVoice({
      telegram: ctx.telegram,
      botId,
      chatId,
      track: backup,
      requestId: ctx.from?.id ?? null,
      requestName: ctx.from?.first_name || ctx.from?.username || null,
    });
    if (second.ok) return true;
    await notify(ctx, `❌ آهنگ پخش نشد: ${second.reason || first.reason}`);
    return false;
  }

  await notify(ctx, `❌ آهنگ پخش نشد: ${first.reason}`);
  return false;
}

/** /play و /music در گروه: یک آهنگ تصادفی، بدون هیچ پیام اضافه */
export async function handleMusicCommand(ctx: Context): Promise<void> {
  const chatType = ctx.chat?.type;
  if (chatType !== 'group' && chatType !== 'supergroup') {
    const me = await ctx.telegram.getMe().catch(() => null);
    await ctx
      .reply(
        `🎵 پخش موزیک فقط در *گروه* کار می‌کند.\n\n` +
          (me?.username
            ? `ربات @${me.username} را به گروه خود اضافه کنید و در گروه دستور /play بدهید.`
            : 'ربات را به گروه خود اضافه کنید و در گروه دستور /play بدهید.') +
          '\n\n📎 هر آهنگ را که در گروه بفرستید و در کپشن بنویسید «پخش»، به کتابخانه اضافه می‌شود.',
        { parse_mode: 'Markdown' }
      )
      .catch(() => undefined);
    return;
  }

  if (!(await musicAllowed(ctx))) return;
  await playRandomTrack(ctx);
}

/**
 * کاربر آهنگی را در گروه می‌فرستد و می‌گوید «پخش».
 * آهنگ یک‌بار دانلود و در کتابخانهٔ مشترک ذخیره می‌شود (تا بقیهٔ ربات‌ها هم
 * بتوانند آن را پخش کنند) و بی‌درنگ به‌شکل ویس فرستاده می‌شود.
 * true یعنی پیام مربوط به موزیک بود و مدیریت شد.
 */
export async function handleMusicAudio(ctx: Context): Promise<boolean> {
  const chatType = ctx.chat?.type;
  if (chatType !== 'group' && chatType !== 'supergroup') return false;

  const msg: any = ctx.message;
  const info = readAudioFromMessage(msg);
  if (!info) return false;

  const caption = String(msg?.caption || '');
  const wantsPlay = /\/(play|music)\b/i.test(caption) || /(پخش|بپخش|پخشش|پخش کن)/i.test(caption);
  if (!wantsPlay) return false;

  if (!(await musicAllowed(ctx))) return true;

  const botId = getBotId(ctx);
  const chatId = ctx.chat!.id;

  // همان آهنگ ممکن است قبلاً به کتابخانه آمده باشد: file_id تلگرام فقط برای همین
  // ربات معتبر است، پس تطبیق با نام + حجم فایل انجام می‌شود تا آهنگ تکراری
  // ساخته و دوباره دانلود نشود.
  const sameTitle = cleanMusicTitle(info.title);
  const existing = await prisma.musicTrack
    .findFirst({
      where: {
        isActive: true,
        title: sameTitle,
        ...(info.fileSize ? { fileSize: info.fileSize } : {}),
      },
      orderBy: { id: 'desc' },
    })
    .catch(() => null);

  if (existing && audioFileExists(existing.filePath)) {
    const result = await sendTrackAsVoice({
      telegram: ctx.telegram,
      botId,
      chatId,
      track: existing,
      requestId: ctx.from?.id ?? null,
      requestName: ctx.from?.first_name || ctx.from?.username || null,
    });
    if (!result.ok) await notify(ctx, `❌ آهنگ پخش نشد: ${result.reason}`);
    return true;
  }

  if (!(await getSettingBool('music_user_songs'))) {
    await notify(
      ctx,
      '🎵 افزودن آهنگ توسط کاربران غیرفعال است. فقط مدیریت از پنل می‌تواند آهنگ بگذارد.'
    );
    return true;
  }

  // فایل باید به کتابخانهٔ مشترک بیاید: file_id این ربات برای ربات‌های دیگر
  // معتبر نیست
  const maxMb =
    (await getSettingNumber('music_max_mb')) || MUSIC_DEFAULT_MAX_MB;
  if (info.fileSize && info.fileSize > maxMb * 1024 * 1024) {
    await notify(
      ctx,
      `❌ حجم این آهنگ بیشتر از حد مجاز (${maxMb} مگابایت) است. از پنل آپلودش کنید.`
    );
    return true;
  }

  const filePath = await downloadToLibrary(ctx.telegram, info.fileId, info.mimeType, info.fileName);
  if (!filePath) {
    await notify(
      ctx,
      `❌ فایل این آهنگ قابل دانلود نبود (حداکثر ${Math.round(
        BOT_API_DOWNLOAD_MAX_BYTES / (1024 * 1024)
      )} مگابایت با Bot API). از پنل آپلودش کنید.`
    );
    return true;
  }

  const track = await prisma.musicTrack
    .create({
      data: {
        title: sameTitle,
        artist: info.artist ? info.artist.slice(0, 64) : null,
        filePath,
        duration: info.duration ?? null,
        fileSize: info.fileSize ?? null,
        mimeType: info.mimeType ?? null,
        addedBy: ctx.from ? BigInt(ctx.from.id) : null,
        source: 'group',
      },
    })
    .catch((error) => {
      console.error('Music track create error:', error);
      return null;
    });

  if (!track) {
    await notify(ctx, '❌ آهنگ در کتابخانه ذخیره نشد، دوباره تلاش کنید.');
    return true;
  }

  const result = await sendTrackAsVoice({
    telegram: ctx.telegram,
    botId,
    chatId,
    track,
    requestId: ctx.from?.id ?? null,
    requestName: ctx.from?.first_name || ctx.from?.username || null,
  });
  if (!result.ok) await notify(ctx, `❌ آهنگ پخش نشد: ${result.reason}`);
  return true;
}

/**
 * پخش یک آهنگ مشخص در یک گروه، از طرف پنل (دکمهٔ «پخش در گروه»).
 * همان مسیری که دستور /play می‌رود: ویس با کپشن نام آهنگ و آیدی ربات.
 */
export async function playTrackInChat(input: {
  telegram: any;
  botId: number;
  chatId: number | string;
  track: { id: number; title: string; filePath: string; duration: number | null };
  requestName?: string | null;
}): Promise<SendResult> {
  const numericChat = Number(input.chatId);
  if (!Number.isFinite(numericChat)) return { ok: false, reason: 'شناسهٔ گروه معتبر نیست.' };
  return sendTrackAsVoice({
    telegram: input.telegram,
    botId: input.botId,
    chatId: numericChat,
    track: input.track,
    requestName: input.requestName ?? 'پنل مدیریت',
  });
}

/**
 * رکوردهای «در حال پخش» که پخش‌کننده‌شان دیگر وجود ندارد (ربات ری‌استارت شده یا
 * گروه خاموش شده) بسته می‌شوند تا آمار پنل گمراه‌کننده نباشد.
 */
export async function reconcileMusicPlays(): Promise<number> {
  const stale = await prisma.musicPlay
    .findMany({
      where: { status: 'PLAYING', startedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
      select: { id: true },
    })
    .catch(() => []);

  let closed = 0;
  for (const row of stale) {
    if (openPlays.has(row.id)) {
      const timer = openPlays.get(row.id);
      if (timer) clearTimeout(timer);
      openPlays.delete(row.id);
    }
    await prisma.musicPlay
      .update({ where: { id: row.id }, data: { status: 'STOPPED', endedAt: new Date() } })
      .catch(() => undefined);
    closed++;
  }
  return closed;
}

setInterval(() => {
  // حافظهٔ گروه‌های بی‌کار پاک شود تا نقشهٔ حافظه بی‌حد بزرگ نشود
  const cutoff = Date.now() - IDLE_MEMORY_MS;
  for (const [key, memory] of memories.entries()) {
    if (memory.lastUsedAt < cutoff) memories.delete(key);
  }
}, 30 * 60_000);

setInterval(() => {
  void reconcileMusicPlays().catch(() => undefined);
}, 10 * 60_000);

/** فقط برای تست: شمارۀ فایل ویس کش‌شدهٔ یک ربات روی یک آهنگ */
export function cachedVoiceId(botId: number, trackId: number): string | undefined {
  return voiceIds.get(`${botId}:${trackId}`);
}

/** فقط برای تست: پاک‌کردن کش file_id (مثلاً بعد از حذف فایل) */
export function forgetCachedVoiceId(botId: number, trackId: number): void {
  voiceIds.delete(`${botId}:${trackId}`);
}

/** فقط برای تست: چند رکورد پخش باز است */
export function openPlayCount(): number {
  return openPlays.size;
}
