import fs from 'node:fs';
import path from 'node:path';
import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { getSettingBool } from '../lib/settings.js';
import { getBotId } from '../lib/bot-context.js';
import {
  audioFileExists,
  audioExtension,
  cleanMusicTitle,
  countActiveTracks,
  downloadToLibrary,
  formatDuration,
  libraryRelativePath,
  pickRandomTrack,
  readAudioFromMessage,
} from '../lib/music-library.js';
import {
  resolvePlaybackMode,
  stopVoiceCall,
  streamInVoiceCall,
  voiceStatusFor,
  type PlaybackMode,
} from '../lib/music-voice.js';

// ─── پخش‌کنندهٔ موزیک گروه ────────────────────
// کارت پخش یک پیام ثابت در گروه است (دکمه‌های بعدی/توقف روی آن می‌مانند) و
// هر آهنگ یک پیام جداگانه. وقتی آهنگ قطع می‌شود —چه با دکمهٔ توقف، چه با
// پایان مدت آن— پیام‌های ربات دقیقاً MUSIC_PURGE_DELAY_MS بعد از گروه پاک
// می‌شوند تا گروه شلوغ نماند.
//
// دو جا برای صدا وجود دارد:
//   • chat  → ربات خودش فایل صوتی را در چت می‌فرستد (پیش‌فرض، فقط Bot API)
//   • voice → آهنگ داخل ویس‌کال گروه استریم می‌شود؛ این کار را سرویس
//     sulduz-voice با یک حساب کاربری تلگرام انجام می‌دهد و ربات فقط فرمان
//     می‌دهد و نتیجه را در همان کارت نشان می‌دهد.
export const MUSIC_PURGE_DELAY_MS = 10_000;

/** آهنگ آپلودی از پنل که مدت آن مشخص نیست، حداکثر ۱۰ دقیقه «در حال پخش» می‌ماند */
const UNKNOWN_DURATION_MS = 10 * 60_000;
/** چند آهنگٔ اخیر در یک گروه پخش نشوند تا تکرار پشت‌سرهم نداشته باشیم */
const MAX_RECENT = 6;
/** پلیر بی‌کار بعد از این مدت فراموش می‌شود */
const IDLE_PLAYER_MS = 2 * 60 * 60_000;
/** هر چند ثانیه از سرویس ویس‌کال بپرسیم آهنگ هنوز پخش است یا تمام شده */
const VOICE_POLL_MS = 5_000;

type MusicAction = 'play' | 'next' | 'stop' | 'card';

interface MusicPlayer {
  botId: number;
  chatId: number;
  playing: boolean;
  cardId?: number;
  audioId?: number;
  playId?: number;
  trackId?: number;
  title?: string;
  artist?: string;
  duration?: number;
  startedAt?: number;
  requestId?: number;
  requestName?: string;
  /** صدا از چت می‌آید یا از ویس‌کال گروه */
  mode?: PlaybackMode;
  /**
   * شمارهٔ هر پخش. تایمر پایان آهنگ و بازجویی ویس‌کال همین را نگه می‌دارند؛
   * وقتی با «آهنگ بعدی» یا «توقف» پخش تازه‌ای شروع شود، شمارۀ قبلی بازنشسته
   * می‌شود و آن timerِ کهنه وضعیت آهنگ جدید را خراب نمی‌کند.
   */
  seq: number;
  recent: number[];
  tracked: Set<number>;
  timers: Set<NodeJS.Timeout>;
  /** شمارۀ بازجویی وضعیت پخش ویس‌کال */
  poll?: NodeJS.Timeout;
  telegram?: any;
  lastUsedAt: number;
}

const players = new Map<string, MusicPlayer>();

function keyOf(botId: number, chatId: number): string {
  return `${botId}:${chatId}`;
}

function playerOf(ctx: Context): MusicPlayer | null {
  const chatId = ctx.chat?.id;
  if (typeof chatId !== 'number') return null;
  const botId = getBotId(ctx);
  const key = keyOf(botId, chatId);
  let player = players.get(key);
  if (!player) {
    player = {
      botId,
      chatId,
      playing: false,
      mode: 'chat',
      seq: 0,
      recent: [],
      tracked: new Set<number>(),
      timers: new Set<NodeJS.Timeout>(),
      lastUsedAt: Date.now(),
    };
    players.set(key, player);
  }
  player.telegram = ctx.telegram;
  player.lastUsedAt = Date.now();
  return player;
}

/** فقط برای تست/عیب‌یابی: وضعیت پلیر یک گروه */
export function musicPlayerFor(botId: number, chatId: number) {
  return players.get(keyOf(botId, chatId));
}

export function musicPlayerCount(): number {
  return players.size;
}

function after(player: MusicPlayer, ms: number, run: () => void): void {
  const timer = setTimeout(() => {
    player.timers.delete(timer);
    run();
  }, ms);
  player.timers.add(timer);
}

/**
 * پخش در ویس‌کال پایانِ پیامی ندارد: از سرویس می‌پرسیم هنوز پخش است یا نه.
 * همین چرخه همچنین اگر اتصال حساب قطع شد، وضعیت گروه را درست می‌کند.
 */
function startVoicePoll(player: MusicPlayer): void {
  stopVoicePoll(player);
  const seq = player.seq;
  const timer = setInterval(() => {
    void (async () => {
      if (!player.playing || player.mode !== 'voice' || player.seq !== seq) {
        stopVoicePoll(player);
        return;
      }
      const status = await voiceStatusFor(player.chatId);
      if (status === null) return; // سرویس موقتاً پاسخ نمی‌دهد: چیزی را خراب نکن
      if (status !== 'playing' && status !== 'paused') {
        stopVoicePoll(player);
        await finishTrack(player, 'FINISHED');
      }
    })();
  }, VOICE_POLL_MS);
  player.poll = timer;
}

function stopVoicePoll(player: MusicPlayer): void {
  if (player.poll) {
    clearInterval(player.poll);
    player.poll = undefined;
  }
}

function trackMessage(player: MusicPlayer, messageId?: number): void {
  if (typeof messageId === 'number' && messageId > 0) player.tracked.add(messageId);
}

function messageIdOf(sent: any): number | undefined {
  if (typeof sent === 'number') return sent;
  return typeof sent?.message_id === 'number' ? sent.message_id : undefined;
}

function fileIdOf(sent: any): string | undefined {
  return sent?.audio?.file_id || sent?.document?.file_id || sent?.voice?.file_id || undefined;
}

async function purgeMessages(telegram: any, chatId: number, ids: number[]): Promise<void> {
  for (const messageId of ids) {
    try {
      await telegram.deleteMessage(chatId, messageId);
    } catch {
      // بدون حق حذف پیام: لااقل دکمه‌ها را بردار تا کسی روی پیام کهنه کلیک نکند
      try {
        await telegram.editMessageReplyMarkup(chatId, messageId, undefined);
      } catch {
        /* پیام از قبل پاک شده */
      }
    }
    players.forEach((player) => {
      if (player.chatId === chatId) player.tracked.delete(messageId);
    });
  }
}

/**
 * پیام‌های مربوط به یک آهنگ تمام‌شده، ۱۰ ثانیه بعد پاک می‌شوند.
 * خودِ پیام‌ها همین حالا از کارت پلیر جدا می‌شوند تا اگر آهنگ تازه‌ای پخش شد،
 * پیام‌های آن پاک نشود.
 */
function schedulePurge(player: MusicPlayer, ids: number[]): void {
  const targets = ids.filter((id) => typeof id === 'number' && id > 0);
  if (targets.length === 0) return;
  for (const id of targets) player.tracked.delete(id);
  after(player, MUSIC_PURGE_DELAY_MS, () => {
    void purgeMessages(player.telegram, player.chatId, targets);
  });
}

function cardKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔀 آهنگ بعدی', 'music:next'),
      Markup.button.callback('⏹ توقف', 'music:stop'),
    ],
    [Markup.button.callback('🎵 پخش تصادفی', 'music:play')],
  ]);
}

async function cardText(player: MusicPlayer): Promise<string> {
  const total = await countActiveTracks(player.botId).catch(() => 0);
  if (player.playing) {
    const lines = [
      '🎵 پخش‌کنندهٔ موزیک',
      '',
      player.mode === 'voice'
        ? `▶️ در حال پخش در ویس‌کال گروه: ${player.title || '—'}`
        : `▶️ در حال پخش: ${player.title || '—'}`,
      player.artist ? `🎧 ${player.artist}` : null,
      player.requestName ? `🙋 درخواست: ${player.requestName}` : null,
      `⏱ مدت: ${formatDuration(player.duration)}`,
      '',
      `🎼 ${total} آهنگ در کتابخانهٔ این ربات`,
      '',
      '📎 برای افزودن آهنگ: فایل آهنگ را در گروه بفرستید و در کپشن بنویسید «پخش».',
    ];
    return lines.filter(Boolean).join('\n');
  }
  return [
    '🎵 پخش‌کنندهٔ موزیک',
    '',
    '⏸ چیزی در حال پخش نیست.',
    `🎼 ${total} آهنگ در کتابخانهٔ این ربات`,
    '',
    '📎 برای افزودن آهنگ: فایل آهنگ را در گروه بفرستید و در کپشن بنویسید «پخش».',
    '🔘 با دکمهٔ پایین، ربات یکی از آهنگ‌ها را تصادفی پخش می‌کند.',
  ].join('\n');
}

/** کارت پخش: اگر در گروه هست، ویرایش می‌شود؛ اگر نیست، فرستاده می‌شود */
async function renderCard(player: MusicPlayer): Promise<void> {
  const text = await cardText(player);
  const markup = cardKeyboard();
  if (player.cardId && player.telegram) {
    try {
      await player.telegram.editMessageText(player.chatId, player.cardId, undefined, text, markup);
      return;
    } catch {
      /* پیام قبلی پاک شده باشد، پایین‌تر از نو فرستاده می‌شود */
    }
  }
  try {
    const sent: any = await player.telegram.sendMessage(player.chatId, text, markup);
    const messageId = messageIdOf(sent);
    player.cardId = messageId;
    trackMessage(player, messageId);
  } catch (error: any) {
    console.error('Music card error:', error?.description || error?.message);
  }
}

/** فایل محلی آهنگ → ورودی تلگرام (برای آهنگی که file_id ندارد) */
function localInputFile(track: { filePath: string | null; title: string; mimeType: string | null }) {
  if (!audioFileExists(track.filePath)) return null;
  const filePath = track.filePath as string;
  const name = path.basename(filePath);
  const ext = audioExtension(track.mimeType, name);
  const filename = name.includes('.') ? name : `${track.title || 'track'}.${ext}`;
  return { source: fs.createReadStream(filePath), filename };
}

/**
 * رکورد پخش می‌سازد.
 * MusicPlay به جدول گروه‌ها وابسته (FK) است؛ اگر گروه هنوز در آن جدول نبود —
 * مثلاً پخشی که از پنل برای گروهی آغاز می‌شود که ربات پیامی در آن ندیده —
 * یک سطر ساده برای گروه ساخته و یک بار دیگر تلاش می‌شود. این‌طور هیچ پخشی
 * از آمار پنل جا نمی‌ماند.
 */
export async function registerMusicPlay(input: {
  trackId: number;
  botId: number;
  chatId: number | bigint;
  status?: 'PLAYING' | 'FINISHED' | 'STOPPED' | 'FAILED';
  requestId?: bigint | number | null;
  requestName?: string | null;
  messageId?: bigint | number | null;
  /** audio = پیام صوتی در چت، voice = استریم در ویس‌کال گروه */
  mode?: 'audio' | 'voice';
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
    mode: input.mode ?? 'audio',
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
    .catch(() => null);

  const again = await prisma.musicPlay.create({ data }).catch((error) => {
    console.error('MusicPlay create error:', error?.message || error);
    return null;
  });
  return again;
}

type StoredTrack = NonNullable<Awaited<ReturnType<typeof pickRandomTrack>>>;

/** پایان آهنگ: مدت معلوم → همان‌قدر، مدت نامعلوم → سقف ۱۰ دقیقه */
function durationMsOf(track: { duration: number | null }): number {
  return (track.duration || 0) > 0 ? track.duration! * 1000 : UNKNOWN_DURATION_MS;
}

/**
 * پخش آهنگ در ویس‌کال گروه، با کمک سرویس sulduz-voice و یک حساب تلگرام.
 * اگر ممکن نشود، دلیل فارسی برمی‌گردد تا ربات همان را در گروه بگوید و آهنگ را
 * به روش قدیمی (پیام صوتی در چت) پخش کند — شنونده بی‌صدا نماند.
 */
async function playViaVoice(
  ctx: Context,
  player: MusicPlayer,
  track: StoredTrack
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let filePath = audioFileExists(track.filePath) ? (track.filePath as string) : '';

  // فایل محلی لازم است: file_id فقط به ربات می‌چسبد و حساب کاربری تلگرام با آن
  // نمی‌تواند فایل را بخواند. آهنگ یک‌بار دانلود و مسیرش ذخیره می‌شود.
  if (!filePath && track.fileId) {
    await notify(ctx, player, '⏳ در حال آماده‌سازی آهنگ برای پخش در ویس‌کال…');
    const downloaded = await downloadToLibrary(
      ctx.telegram,
      track.fileId,
      player.botId,
      track.mimeType,
      track.title
    );
    if (downloaded) {
      await prisma.musicTrack
        .update({ where: { id: track.id }, data: { filePath: downloaded } })
        .catch(() => undefined);
      filePath = downloaded;
    }
  }
  if (!filePath) {
    return { ok: false, reason: 'فایل این آهنگ روی سرور نبود، پس در چت پخش می‌شود.' };
  }

  const result = await streamInVoiceCall({
    chatId: player.chatId,
    path: libraryRelativePath(filePath),
    title: track.title,
    duration: track.duration ?? 0,
  });
  if (!result.ok) {
    return { ok: false, reason: result.error || 'پخش در ویس‌کال ممکن نشد، در چت پخش می‌شود.' };
  }

  player.seq += 1;
  const seq = player.seq;
  player.playing = true;
  player.mode = 'voice';
  player.audioId = undefined; // در این حالت پیام صوتی در چت نمی‌رود
  player.trackId = track.id;
  player.title = track.title;
  player.artist = track.artist || undefined;
  player.duration = track.duration || undefined;
  player.startedAt = Date.now();
  player.requestId = ctx.from?.id;
  player.requestName = ctx.from?.first_name || ctx.from?.username || undefined;
  player.recent = [track.id, ...player.recent].slice(0, MAX_RECENT);

  const play = await registerMusicPlay({
    trackId: track.id,
    botId: player.botId,
    chatId: player.chatId,
    requestId: ctx.from ? BigInt(ctx.from.id) : null,
    requestName: player.requestName || null,
    mode: 'voice',
    status: 'PLAYING',
  });
  player.playId = play?.id;

  await prisma.musicTrack
    .update({ where: { id: track.id }, data: { playCount: { increment: 1 } } })
    .catch(() => undefined);

  startVoicePoll(player);
  // تورِ پشتیبان: اگر سرویس پاسخ نداد، رکورد «در حال پخش» معلق نمی‌ماند
  after(player, durationMsOf(track) + 30_000, () => {
    if (player.seq === seq && player.mode === 'voice') void finishTrack(player, 'FINISHED');
  });

  await renderCard(player);
  return { ok: true };
}

/**
 * یک آهنگ را در گروه پخش می‌کند.
 * از file_id استفاده می‌کند اگر موجود باشد؛ وگرنه فایل محلی را آپلود می‌کند و
 * file_id برگشتی را برای دفعات بعد ذخیره می‌کند.
 * اگر گروه روی حالت ویس‌کال باشد، اول همان راه امتحان می‌شود.
 */
async function playTrack(
  ctx: Context,
  player: MusicPlayer,
  track: StoredTrack
): Promise<boolean> {
  if ((await resolvePlaybackMode(player.botId, player.chatId)) === 'voice') {
    const voice = await playViaVoice(ctx, player, track);
    if (voice.ok) return true;
    await notify(ctx, player, `🎧 ${voice.reason}`);
  }

  const payload: any = track.fileId || localInputFile(track);
  if (!payload) {
    return false;
  }

  const extra: any = { disable_notification: true };
  if (track.kind === 'document') extra.caption = `🎵 ${track.title}`;
  if (track.kind === 'audio') {
    extra.title = track.title;
    if (track.artist) extra.performer = track.artist.slice(0, 64);
  }

  let sent: any;
  try {
    if (track.kind === 'document') {
      sent = await ctx.replyWithDocument(payload as any, extra);
    } else if (track.kind === 'voice') {
      sent = await ctx.replyWithVoice(payload as any, extra);
    } else {
      sent = await ctx.replyWithAudio(payload as any, extra);
    }
  } catch (error: any) {
    console.error(
      'Music send error:',
      error?.description || error?.message || String(error)
    );
    await registerMusicPlay({
      trackId: track.id,
      botId: player.botId,
      chatId: player.chatId,
      requestId: ctx.from ? BigInt(ctx.from.id) : null,
      requestName: ctx.from?.first_name || ctx.from?.username || null,
      status: 'FAILED',
      endedAt: new Date(),
    });
    return false;
  }

  const messageId = messageIdOf(sent);
  const cachedFileId = fileIdOf(sent);

  // آهنگ آپلودی از پنل: file_id را برای پخش‌های بعدی نگه می‌داریم
  if (cachedFileId && !track.fileId) {
    await prisma.musicTrack
      .update({ where: { id: track.id }, data: { fileId: cachedFileId } })
      .catch(() => undefined);
  }

  trackMessage(player, messageId);
  player.seq += 1;
  const seq = player.seq;
  player.audioId = messageId;
  player.playing = true;
  player.mode = 'chat';
  player.trackId = track.id;
  player.title = track.title;
  player.artist = track.artist || undefined;
  player.duration = track.duration || undefined;
  player.startedAt = Date.now();
  player.requestId = ctx.from?.id;
  player.requestName = ctx.from?.first_name || ctx.from?.username || undefined;
  player.recent = [track.id, ...player.recent].slice(0, MAX_RECENT);

  const play = await registerMusicPlay({
    trackId: track.id,
    botId: player.botId,
    chatId: player.chatId,
    requestId: ctx.from ? BigInt(ctx.from.id) : null,
    requestName: player.requestName || null,
    messageId: messageId ?? null,
    status: 'PLAYING',
  });
  player.playId = play?.id;

  await prisma.musicTrack
    .update({ where: { id: track.id }, data: { playCount: { increment: 1 } } })
    .catch(() => undefined);

  // پایان آهنگ: مدت معلوم → همان‌قدر، مدت نامعلوم → سقف ۱۰ دقیقه
  after(player, durationMsOf(track), () => {
    // اگر تا این لحظه «آهنگ بعدی» پخش شده باشد، این تور کهنه است و نباید
    // وضعیت آهنگ تازه را خراب کند
    if (player.seq === seq && player.mode === 'chat') void finishTrack(player, 'FINISHED');
  });

  await renderCard(player);
  return true;
}

/**
 * پیام‌های دورِ جاری پخش که باید از گروه بروند.
 * همه‌شان در player.tracked ثبت شده‌اند؛ فقط آنچه در keep هست (کارت «آهنگ بعدی»)
 * نگه داشته می‌شود.
 */
function staleIds(player: MusicPlayer, keep: Array<number | undefined>): number[] {
  const keepIds = new Set(keep.filter((id): id is number => typeof id === 'number'));
  return [...player.tracked].filter((id) => !keepIds.has(id));
}

/** ثبت پایان آهنگ، پاک‌کردن پیام‌ها ۱۰ ثانیه بعد و آماده شدن برای آهنگ بعد */
async function finishTrack(
  player: MusicPlayer,
  status: 'FINISHED' | 'STOPPED',
  options?: { keepCard?: boolean }
): Promise<boolean> {
  if (!player.playing) return false;

  const playId = player.playId;
  const cardId = player.cardId;
  const wasVoice = player.mode === 'voice';

  // هر تور یا بازجویی کهنه از این لحظه بی‌اثر است
  player.seq += 1;
  stopVoicePoll(player);

  player.playing = false;
  player.playId = undefined;
  player.audioId = undefined;
  player.trackId = undefined;
  player.title = undefined;
  player.artist = undefined;
  player.duration = undefined;
  player.startedAt = undefined;
  player.mode = 'chat';

  if (wasVoice) {
    // سکوت بی‌درنگ: استریم ویس‌کال همان لحظه بسته می‌شود
    await stopVoiceCall(player.chatId);
  }

  if (playId) {
    await prisma.musicPlay
      .update({ where: { id: playId }, data: { status, endedAt: new Date() } })
      .catch(() => undefined);
  }

  if (options?.keepCard) {
    // «آهنگ بعدی»: کارت همان کارت می‌ماند، اما آهنگ و پیام‌های آهنگ قبلی می‌روند
    schedulePurge(player, staleIds(player, [cardId]));
    return true;
  }

  // کارت پیش از رفتن به حالت «بی‌کار» ویرایش می‌شود تا در این ۱۰ ثانیه
  // دروغِ «در حال پخش» نشان ندهد؛ بعد همه (کارت و پیام‌های آهنگ) پاک می‌شوند
  await renderCard(player);
  player.cardId = undefined;
  schedulePurge(player, staleIds(player, []));
  return true;
}

/**
 * پیام کوتاه گروهی (راهنما/تأیید). همان‌طور که خواسته شده پیام‌های موزیک نباید
 * در گروه بمانند و آزاردهنده باشند: این پیام‌ها ۱۰ ثانیه بعد پاک می‌شوند.
 */
async function notify(ctx: Context, player: MusicPlayer, text: string, extra?: any): Promise<void> {
  try {
    const sent: any = await ctx.reply(text, extra);
    const messageId = messageIdOf(sent);
    if (typeof messageId === 'number') schedulePurge(player, [messageId]);
  } catch {
    /* ربات اجازه فرستادن پیام ندارد */
  }
}

async function isMusicEnabled(ctx: Context, player?: MusicPlayer): Promise<boolean> {
  const enabled = await getSettingBool('music_enabled');
  if (!enabled) {
    const text = '🎵 بخش پخش موزیک در این ربات غیرفعال است. از مدیریت پنل فعالش کنید.';
    if (player) await notify(ctx, player, text);
    else await ctx.reply(text).catch(() => undefined);
  }
  return enabled;
}

/** پخش تصادفی (دکمهٔ 🎵 و دستور /play) */
async function startRandom(ctx: Context, player: MusicPlayer): Promise<void> {
  const track = await pickRandomTrack(player.botId, player.recent);
  if (!track) {
    await notify(
      ctx,
      player,
      '🎵 کتابخانهٔ این ربات خالی است.\n\n' +
        'به پنل مدیریت بروید و از بخش «موزیک» آهنگ آپلود کنید، یا فایل آهنگ را در همین گروه بفرستید و در کپشن بنویسید «پخش».'
    );
    return;
  }

  const ok = await playTrack(ctx, player, track);
  if (!ok) {
    // فایلش روی دیسک نیست یا تلگرام نپذیرفت: یک فرصت دیگر با آهنگ دیگر
    const backup = await pickRandomTrack(player.botId, [...player.recent, track.id]);
    if (backup && backup.id !== track.id) {
      const retried = await playTrack(ctx, player, backup);
      if (retried) return;
    }
    await notify(ctx, player, '❌ این آهنگ قابل پخش نیست (فایلش موجود نیست).');
  }
}

/** آهنگ بعدی: آهنگ فعلی بی‌درنگ پاک می‌شود، بعدی تصادفی پخش می‌شود */
async function nextTrack(ctx: Context, player: MusicPlayer): Promise<void> {
  if (player.playing) {
    const previousAudio = player.audioId;
    await finishTrack(player, 'FINISHED', { keepCard: true });
    // در «بعدی» نیازی به صبر ۱۰ ثانیه‌ای نیست: آهنگ قدیمی همان لحظه می‌رود
    if (previousAudio && player.telegram) {
      player.tracked.delete(previousAudio);
      void purgeMessages(player.telegram, player.chatId, [previousAudio]);
    }
  }
  await startRandom(ctx, player);
}

async function stopPlayer(ctx: Context, player: MusicPlayer): Promise<void> {
  const wasVoice = player.mode === 'voice';
  const stopped = await finishTrack(player, 'STOPPED');
  if (!stopped) {
    // پلیر چیزی را نگه نمی‌دارد؛ اگر گروه ویس‌کال است لااقل استریم جا‌مانده را
    // ببند (مثلاً ربات ری‌استارت شده باشد)
    if (!wasVoice && (await resolvePlaybackMode(player.botId, player.chatId)) === 'voice') {
      await stopVoiceCall(player.chatId);
    }
    await notify(ctx, player, '⏹ چیزی در حال پخش نیست.');
    // کارت بی‌کار هم ۱۰ ثانیه بعد از گروه می‌رود
    if (player.cardId) {
      const cardId = player.cardId;
      player.cardId = undefined;
      schedulePurge(player, [cardId]);
    }
    return;
  }
  await notify(ctx, player, '⏹ پخش متوقف شد. پیام‌های موزیک ۱۰ ثانیه بعد پاک می‌شوند.');
}

/**
 * دستورهای گروه: /music (کارت)، /play (پخش تصادفی)، /next، /stop
 */
export async function handleMusicCommand(ctx: Context, action: MusicAction): Promise<void> {
  const chatType = ctx.chat?.type;
  if (chatType !== 'group' && chatType !== 'supergroup') {
    const me = await ctx.telegram.getMe().catch(() => null);
    await ctx
      .reply(
        `🎵 پخش موزیک فقط در *گروه* کار می‌کند.\n\n` +
          (me?.username ? `ربات @${me.username} را به گروه خود اضافه کنید و در گروه دستور دهید.` : '') +
          '\n\nدستورهای گروه: /music ، /play ، /next ، /stop',
        { parse_mode: 'Markdown' }
      )
      .catch(() => undefined);
    return;
  }

  const player = playerOf(ctx);
  if (!player) return;
  if (!(await isMusicEnabled(ctx, player))) return;

  switch (action) {
    case 'play':
      await startRandom(ctx, player);
      break;
    case 'next':
      await nextTrack(ctx, player);
      break;
    case 'stop':
      await stopPlayer(ctx, player);
      break;
    case 'card':
    default:
      await renderCard(player);
      break;
  }
}

/**
 * دکمه‌های کارت پخش: music:play | music:next | music:stop
 */
export async function handleMusicAction(ctx: Context): Promise<void> {
  const data = String((ctx as any).callbackQuery?.data || '');
  const action: MusicAction = data.includes('next')
    ? 'next'
    : data.includes('stop')
      ? 'stop'
      : data.includes('play')
        ? 'play'
        : 'card';

  const chatType = ctx.chat?.type;
  if (chatType !== 'group' && chatType !== 'supergroup') {
    await ctx.answerCbQuery('🎵 موزیک فقط در گروه پخش می‌شود').catch(() => undefined);
    return;
  }

  const player = playerOf(ctx);
  if (!player) return;
  const enabled = await getSettingBool('music_enabled');
  if (!enabled) {
    await ctx.answerCbQuery('بخش موزیک غیرفعال است', { show_alert: true }).catch(() => undefined);
    return;
  }

  await ctx.answerCbQuery().catch(() => undefined);

  if (action === 'play') await startRandom(ctx, player);
  else if (action === 'next') await nextTrack(ctx, player);
  else if (action === 'stop') await stopPlayer(ctx, player);
  else await renderCard(player);
}

/**
 * کاربر آهنگی را در گروه می‌فرستد و می‌گوید «پخش کن».
 * آهنگ در کتابخانهٔ ربات ذخیره می‌شود (file_id تلگرام، بدون دانلود) و بی‌درنگ
 * پخش می‌شود؛ بقیه کاربران هم بعداً می‌توانند آن را تصادفی بشنوند.
 * true یعنی پیام موزیک بود و مدیریت شد.
 */
export async function handleMusicAudio(ctx: Context): Promise<boolean> {
  const chatType = ctx.chat?.type;
  if (chatType !== 'group' && chatType !== 'supergroup') return false;

  const msg: any = ctx.message;
  const info = readAudioFromMessage(msg);
  if (!info) return false;

  const caption = String(msg?.caption || '');
  const wantsPlay =
    /\/(play|music)\b/i.test(caption) || /(پخش|بپخش|پخشش|پخش کن)/i.test(caption);

  const player = playerOf(ctx);
  if (!player) return false;

  const isReplyToPlayer =
    typeof msg?.reply_to_message?.message_id === 'number' &&
    player.tracked.has(msg.reply_to_message.message_id);

  if (!wantsPlay && !isReplyToPlayer) return false;

  if (!(await isMusicEnabled(ctx, player))) return true;

  const botId = player.botId;
  const existing = await prisma.musicTrack
    .findFirst({ where: { botId, fileId: info.fileId } })
    .catch(() => null);

  let track = existing;
  if (!track) {
    if (!(await getSettingBool('music_user_songs'))) {
      await notify(
        ctx,
        player,
        '🎵 افزودن آهنگ توسط کاربران غیرفعال است. فقط مدیریت از پنل می‌تواند آهنگ بگذارد.'
      );
      return true;
    }
    const created = await prisma.musicTrack
      .create({
        data: {
          botId,
          title: cleanMusicTitle(info.title),
          artist: info.artist ? info.artist.slice(0, 64) : null,
          fileId: info.fileId,
          filePath: null,
          duration: info.duration ?? null,
          fileSize: info.fileSize ?? null,
          mimeType: info.mimeType ?? null,
          kind: info.kind,
          addedBy: ctx.from ? BigInt(ctx.from.id) : null,
          source: 'group',
        },
      })
      .catch((error) => {
        console.error('Music track create error:', error);
        return null;
      });
    if (!created) {
      await notify(ctx, player, '❌ آهنگ ذخیره نشد، دوباره تلاش کنید.');
      return true;
    }
    track = created;
  }

  if (player.playing) {
    const previousAudio = player.audioId;
    await finishTrack(player, 'FINISHED', { keepCard: true });
    if (previousAudio && player.telegram) {
      player.tracked.delete(previousAudio);
      void purgeMessages(player.telegram, player.chatId, [previousAudio]);
    }
  }

  await notify(ctx, player, `🎧 درخواست: ${track.title}`);

  const ok = await playTrack(ctx, player, track as any);
  if (!ok) {
    await notify(ctx, player, '❌ این آهنگ قابل پخش نبود (فایلش موجود نیست).');
    await renderCard(player);
  }
  return true;
}

// پلیرهای رهاشده: گروهی که ساعت‌ها چیزی پخش نکرده، حافظه نگه ندارد.
setInterval(() => {
  const cutoff = Date.now() - IDLE_PLAYER_MS;
  for (const [key, player] of players.entries()) {
    if (player.playing || player.tracked.size > 0 || player.lastUsedAt >= cutoff) continue;
    stopVoicePoll(player);
    for (const timer of player.timers) clearTimeout(timer);
    player.timers.clear();
    players.delete(key);
  }
}, 10 * 60_000);

/**
 * رکوردهای «در حال پخش» که پلیرشان دیگر وجود ندارد (ربات ری‌استارت شده یا
 * گروه خاموش شده) بسته می‌شوند تا آمار پنل گمراه‌کننده نباشد.
 */
export async function reconcileMusicPlays(): Promise<number> {
  const stale = await prisma.musicPlay
    .findMany({
      where: { status: 'PLAYING', startedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
      select: { id: true, botId: true, chatId: true, mode: true },
    })
    .catch(() => []);

  let closed = 0;
  for (const row of stale) {
    const player = players.get(keyOf(row.botId, Number(row.chatId)));
    if (player?.playId === row.id) continue;
    await prisma.musicPlay
      .update({ where: { id: row.id }, data: { status: 'STOPPED', endedAt: new Date() } })
      .catch(() => undefined);
    // پخشی که از ویس‌کال مانده (مثلاً ربات ری‌استارت شده) را هم ساکت کن تا
    // آهنگ بی‌صاحب در گروه ادامه نیابد
    if (row.mode === 'voice') await stopVoiceCall(Number(row.chatId));
    closed++;
  }
  return closed;
}

setInterval(() => {
  void reconcileMusicPlays().catch(() => undefined);
}, 10 * 60_000);
