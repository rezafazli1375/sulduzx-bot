import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { getSetting, getSettingBool, getSettingNumber } from '../lib/settings.js';
import { getBotId } from '../lib/bot-context.js';
import { isFeatureAllowed } from '../lib/bot-access.js';
import { audioFileExists } from '../lib/music-library.js';
import { voiceApi, type VoiceResult } from '../lib/voice-client.js';
import { MUSIC_NOTICE_TTL_MS, noteRecentTrack, pickTrackForGroup, registerMusicPlay } from './music.js';

// ─── رادیوی ویس‌کال گروه ─────────────────────
// خواستهٔ کارفرما: کسی در گروه /voicecall می‌زند ← یک **حساب کاربری تلگرام**
// (شمارهٔ مجازی که از پنل وارد شده) به ویس‌کال گروه می‌رود و آهنگ‌ها را یکی‌بعدی
// به‌شکل تصادفی پخش می‌کند، و هر عضو گروه با دکمهٔ ⏹ می‌تواند آن را متوقف کند.
//
// تقسیم کار:
//  · سرویس sulduz-voice (کانتینر جدا، فقط شبکهٔ داخلی داکر) استریم صوتی را با
//    py-tgcalls به تلگرام می‌فرستد و وضعیت هر گروه را نگه می‌دارد.
//  · این فایل «رادیو» است: می‌داند کدام گروه روشن است، آهنگ بعدی را از
//    کتابخانهٔ مشترک انتخاب می‌کند، کارت زندهٔ گروه را به‌روز می‌کند و رکورد
//    آمار پنل را می‌بندد.
//
// وضعیت پخش فقط در حافظهٔ پروسه است (نه دیتابیس): منبع حقیقتِ «چه چیزی دارد
// پخش می‌شود» خودِ سرویس ویس‌کال است و ربات هر چند ثانیه از آن می‌پرسد. با
// ری‌استارت ربات پخش‌های جاافتاده در همان round اول بسته می‌شوند.

const QUALITIES = new Set(['low', 'medium', 'high', 'studio']);

/** هر چند ثانیه وضعیت پخش سرویس بررسی می‌شود */
const TICK_MS = 5_000;
/** چند بار نرسیدن سرویس = خاموش‌کردن رادیو (۳ × ۵ ثانیه) */
const MAX_UNREACHABLE = 3;
/** هر چند tick یک‌بار پخش‌های بی‌صاحب بسته می‌شوند (۶ × ۵ = ۳۰ ثانیه) */
const SWEEP_EVERY_TICKS = 6;

export interface RadioOptions {
  quality: string;
  volume: number;
  autoStart: boolean;
  maxStreams: number;
  /** سقف زمان هر نشست رادیو (دقیقه)؛ صفر یعنی بی‌سقف */
  maxMinutes: number;
  /** حساب انتخابی پنل؛ خالی = اولین حساب آمادهٔ سرویس */
  accountId: string;
}

export interface RadioSession {
  botId: number;
  chatId: number;
  /** پیام کارت در گروه؛ با هر آهنگ تازه ویرایش می‌شود */
  messageId: number | null;
  startedBy: string;
  startedAt: number;
  /** آهنگی که همین حالا در ویس‌کال است */
  trackId: number | null;
  trackTitle: string;
  duration: number;
  playStartedAt: number;
  plays: number;
  /** رکوردهای آمار که این نشست باز کرده و باید بسته شوند */
  playIds: number[];
  busy: boolean;
  failures: number;
  lastError: string | null;
  accountId: string | null;
}

const sessions = new Map<string, RadioSession>();

function keyOf(chatId: number | string): string {
  return String(chatId);
}

/** وضعیت همهٔ نشست‌های باز (برای پنل، دستور و تست) */
export function radioSessions(): RadioSession[] {
  return [...sessions.values()].map((session) => ({ ...session }));
}

export function radioSessionCount(): number {
  return sessions.size;
}

export function radioSessionFor(chatId: number | string): RadioSession | null {
  const session = sessions.get(keyOf(chatId));
  return session ? { ...session } : null;
}

/** فقط برای تست: نشست‌ها را فراموش کن (سرویس را خاموش نکن) */
export function clearRadioSessions(): void {
  sessions.clear();
}

// ─── تنظیمات ─────────────────────────────────
export async function voiceCallEnabled(): Promise<boolean> {
  return getSettingBool('voicecall_enabled');
}

export async function radioOptions(): Promise<RadioOptions> {
  const rawQuality = ((await getSetting('voicecall_quality')) || 'high').toLowerCase();
  const rawAccount = String((await getSetting('voicecall_account')) || '').trim();
  const rawMinutes = await getSetting('voicecall_max_minutes');
  const volume = await getSettingNumber('voicecall_volume');
  const streams = await getSettingNumber('voicecall_max_streams');
  const autoStartRaw = await getSetting('voicecall_auto_start');
  return {
    quality: QUALITIES.has(rawQuality) ? rawQuality : 'high',
    // تنظیم نکرده = صدای کامل؛ اگر کسی ۰ بگذارد هم همان ۱۰۰ در نظر می‌آید
    volume: volume > 0 ? Math.min(200, volume) : 100,
    // «باز کردن ویس‌کال اگر بسته است» پیش‌فرض روشن است: کاربر خودش دستور
    // رادیو را داده و انتظار دارد ویس‌کال خودش باز شود
    autoStart: autoStartRaw === null ? true : autoStartRaw === 'true',
    maxStreams: streams > 0 ? Math.min(streams, 20) : 5,
    maxMinutes: rawMinutes === null ? 120 : Math.max(0, parseInt(rawMinutes, 10) || 0),
    accountId: rawAccount,
  };
}

// ─── متن‌ها ───────────────────────────────────
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function cardText(session: RadioSession, elapsed: number): string {
  const lines = [
    '📻 رادیوی ویس‌کال — روشن',
    '',
    `🎵 ${session.trackTitle || '—'}`,
    `⏱ ${formatClock(elapsed)}${session.duration > 0 ? ` از ${formatClock(session.duration)}` : ''} · آهنگ ${session.plays}ام`,
    `🙋 شروع‌کننده: ${session.startedBy}`,
  ];
  if (session.lastError) lines.push(`⚠️ ${session.lastError}`);
  lines.push('', '⏭ آهنگ بعدی را عوض می‌کند · ⏹ پخش را برای همه خاموش می‌کند');
  return lines.join('\n');
}

function cardKeyboard(chatId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⏭ آهنگ بعدی', `vc_next:${chatId}`),
      Markup.button.callback('⏹ توقف', `vc_stop:${chatId}`),
    ],
  ]);
}

function endedText(session: RadioSession, reason: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - session.startedAt) / 60_000));
  return (
    `📻 رادیوی ویس‌کال خاموش شد\n\n` +
    `🎶 ${session.plays} آهنگ در ${minutes} دقیقه پخش شد\n` +
    `⏹ ${reason}`
  );
}

/** پیام کوتاه خطا در گروه؛ مثل موزیک ۱۰ ثانیه می‌ماند و پاک می‌شود */
async function flash(ctx: Context, text: string): Promise<void> {
  const chatId = ctx.chat?.id;
  if (typeof chatId !== 'number') return;
  try {
    const sent: any = await ctx.reply(text);
    const messageId = typeof sent?.message_id === 'number' ? sent.message_id : undefined;
    if (typeof messageId !== 'number') return;
    const timer = setTimeout(() => {
      ctx.telegram.deleteMessage(chatId, messageId).catch(() => undefined);
    }, MUSIC_NOTICE_TTL_MS);
    timer.unref?.();
  } catch {
    /* ربات اجازهٔ فرستادن یا حذف پیام ندارد */
  }
}

// ─── کارت ────────────────────────────────────
async function refreshCard(session: RadioSession): Promise<void> {
  if (!session.messageId) return;
  const text = cardText(session, Math.round((Date.now() - session.playStartedAt) / 1000));
  try {
    await (await telegramFor(session))?.editMessageText(session.chatId, session.messageId, undefined, text, {
      ...cardKeyboard(session.chatId),
    });
  } catch {
    /* پیام کارت پاک شده یا ربات دسترسی ویرایش ندارد؛ پخش ادامه دارد */
  }
}

async function removeCard(session: RadioSession, reason: string): Promise<void> {
  if (!session.messageId) return;
  const telegram = await telegramFor(session);
  if (!telegram) return;
  try {
    await telegram.editMessageText(session.chatId, session.messageId, undefined, endedText(session, reason));
  } catch {
    await telegram.deleteMessage(session.chatId, session.messageId).catch(() => undefined);
  }
}

/**
 * رباتِ همان گروه؛ برای فرستادن/ویرایش کارت لازم است.
 * ربات‌ها در پروسهٔ ربات زنده‌اند (bot/index.ts) و همین‌جا هم از همان نقشه
 * استفاده می‌شود تا مسیر پنل و گروه یکی بماند.
 *
 * import تنبل است: در هارنس که هیچ رباتی اجرا نمی‌شود resolver تزریق می‌گردد
 * تا اصلاً فایل index.js بار نشود و کارت همان مسیر production را طی کند.
 */
type TelegramResolver = (botId: number) => Promise<any | null> | any | null;
let telegramResolver: TelegramResolver | null = null;

/** فقط برای تست: هندل تلگرام را جای getBotInstance بگذار؛ null یعنی حالت عادی */
export function setRadioTelegramResolver(resolver: TelegramResolver | null): void {
  telegramResolver = resolver;
}

async function telegramFor(session: RadioSession): Promise<any | null> {
  if (telegramResolver) return (await telegramResolver(session.botId)) ?? null;
  const { getBotInstance } = await import('./index.js');
  const bot = getBotInstance(session.botId);
  return bot?.telegram ?? null;
}

// ─── بسته‌کردن رکوردهای آمار ─────────────────
async function closePlays(session: RadioSession, status: 'FINISHED' | 'STOPPED'): Promise<void> {
  const ids = session.playIds;
  session.playIds = [];
  if (!ids.length) return;
  await prisma.musicPlay
    .updateMany({
      where: { id: { in: ids }, status: 'PLAYING' },
      data: { status, endedAt: new Date() },
    })
    .catch(() => undefined);
}

// ─── پخش یک آهنگ در ویس‌کال ──────────────────
async function playTrack(session: RadioSession, reason: 'start' | 'auto' | 'manual'): Promise<boolean> {
  session.busy = true;
  const options = await radioOptions();
  const tried: number[] = [];

  // تا ۳ آهنگ امتحان می‌شود: ممکن است فایل یکی روی سرور نباشد (آهنگی که فقط
  // file_id داشته و دانلود نشده) یا سرویس آن را نپذیرد
  for (let attempt = 0; attempt < 3; attempt++) {
    const track = await pickTrackForGroup(session.botId, session.chatId, tried);
    if (!track) break;
    tried.push(track.id);

    if (!audioFileExists(track.filePath)) {
      session.lastError = 'فایل این آهنگ روی سرور نیست؛ آهنگ دیگری انتخاب شد.';
      continue;
    }

    const result = await voiceApi.play({
      chatId: session.chatId,
      path: track.filePath,
      accountId: options.accountId || undefined,
      title: track.title,
      duration: track.duration ?? 0,
      quality: options.quality,
      volume: options.volume,
      autoStart: options.autoStart,
      maxStreams: options.maxStreams,
    });

    if (!result.ok) {
      session.lastError = result.error || 'پخش در ویس‌کال ناموفق بود.';
      session.failures++;
      console.error('Radio play failed:', reason, result.code, result.error);
      break;
    }

    const stream = result.data?.stream;
    session.trackId = track.id;
    session.trackTitle = track.title;
    session.duration = Number(stream?.duration ?? track.duration ?? 0) || 0;
    session.playStartedAt = Date.now();
    session.accountId = String(stream?.accountId ?? options.accountId ?? '') || null;
    session.failures = 0;
    session.lastError = null;
    session.plays++;
    noteRecentTrack(session.botId, session.chatId, track.id);

    // آهنگ قبلی همین‌جا تمام‌شده حساب می‌شود؛ در هر لحظه حداکثر یک رکورد
    // PLAYING باز می‌ماند و به همان آهنگی belongs که روی ویس‌کال است
    await closePlays(session, 'FINISHED');

    await prisma.musicTrack
      .update({ where: { id: track.id }, data: { playCount: { increment: 1 } } })
      .catch(() => undefined);

    // در رادیو پیامی به چت نمی‌رود، پس messageId رکورد null است؛ همین او را از
    // پخش‌های ویسِ چت متمایز می‌کند و بسته‌شدنش را در دست خودمان می‌گذارد
    const play = await registerMusicPlay({
      trackId: track.id,
      botId: session.botId,
      chatId: session.chatId,
      requestName: session.startedBy,
      messageId: null,
      status: 'PLAYING',
    });
    if (play) session.playIds.push(play.id);

    await refreshCard(session);
    session.busy = false;
    return true;
  }

  session.busy = false;
  return false;
}

// ─── شروع / ادامه / توقف ─────────────────────
export interface StartResult {
  ok: boolean;
  error?: string;
  session?: RadioSession;
}

/**
 * یک نشست رادیو برای گروه می‌سازد و اولین آهنگ را پخش می‌کند.
 * اگر از قبل روشن است، همان نشست برگردانده می‌شود (ok:false با توضیح).
 */
export async function startRadio(input: {
  botId: number;
  chatId: number;
  startedBy?: string;
  messageId?: number | null;
}): Promise<StartResult> {
  const existing = sessions.get(keyOf(input.chatId));
  if (existing) {
    return { ok: false, error: 'رادیوی این گروه همین حالا روشن است.', session: { ...existing } };
  }

  const session: RadioSession = {
    botId: input.botId,
    chatId: input.chatId,
    messageId: input.messageId ?? null,
    startedBy: (input.startedBy || 'گروه').slice(0, 64),
    startedAt: Date.now(),
    trackId: null,
    trackTitle: '',
    duration: 0,
    playStartedAt: Date.now(),
    plays: 0,
    playIds: [],
    busy: false,
    failures: 0,
    lastError: null,
    accountId: null,
  };
  sessions.set(keyOf(input.chatId), session);

  const options = await radioOptions();
  const started = await playTrack(session, 'start');
  if (!started) {
    sessions.delete(keyOf(input.chatId));
    await closePlays(session, 'STOPPED');
    return {
      ok: false,
      error:
        session.lastError ||
        (options.accountId
          ? 'پخش در ویس‌کال شروع نشد.'
          : 'پخش در ویس‌کال شروع نشد؛ حساب تلگرام این سرویس آماده نیست.'),
    };
  }

  return { ok: true, session: { ...session } };
}

/** آهنگ بعدی را همین حالا جایگزین می‌کند (دکمهٔ ⏭ و «اجرا از پنل») */
export async function nextRadioTrack(chatId: number): Promise<StartResult> {
  const session = sessions.get(keyOf(chatId));
  if (!session) return { ok: false, error: 'رادیوی این گروه روشن نیست.' };
  if (session.busy) return { ok: false, error: 'یک لحظه صبر کنید؛ آهنگ قبلی در حال جایگزینی است.' };
  const started = await playTrack(session, 'manual');
  if (!started) return { ok: false, error: session.lastError || 'آهنگ بعدی پخش نشد.', session: { ...session } };
  return { ok: true, session: { ...session } };
}

/** توقف رادیو: استریم بسته، ویس‌کال باز می‌ماند (اعضا خودشان تصمیم می‌گیرند) */
export async function stopRadio(
  chatId: number,
  reason: string,
  options: { close?: boolean } = {}
): Promise<{ ok: boolean; session?: RadioSession; error?: string }> {
  const session = sessions.get(keyOf(chatId));
  if (!session) {
    // نشست locally نداریم؛ اگر سرویس چیزی را باز گذاشته باشد همان‌جا بسته می‌شود
    const result = await voiceApi.stop(chatId, Boolean(options.close));
    return { ok: result.ok, error: result.ok ? undefined : result.error };
  }
  sessions.delete(keyOf(chatId));
  await closePlays(session, 'STOPPED');
  const result = await voiceApi.stop(chatId, Boolean(options.close));
  if (!result.ok) session.lastError = result.error || null;
  await removeCard(session, reason);
  return { ok: result.ok, session: { ...session }, error: result.ok ? undefined : result.error };
}

/** خاموش‌کردن همهٔ رادیوها (دکمهٔ پنل) */
export async function stopAllRadio(reason: string): Promise<{ stopped: number; chats: number[] }> {
  const chats = [...sessions.keys()].map((key) => Number(key));
  for (const chatId of chats) await stopRadio(chatId, reason);
  return { stopped: chats.length, chats };
}

// ─── نگهبان: حلقهٔ رادیو ─────────────────────
let tickCount = 0;

/**
 * یک گام از حلقهٔ رادیو.
 * بیرون از setInterval هم صدا زده می‌شود (تست) تا زمان‌سنجی لازم نباشد.
 */
export async function tickRadio(): Promise<void> {
  tickCount++;

  // ۱) پخش‌های بی‌صاحب: اگر ربات ری‌استارت شده و سرویس هنوز جایی استریم
  //    می‌فرستد، همان استریم بی‌صاحب بسته می‌شود تا صدای بی‌صاحب در گروه نماند
  if (tickCount % SWEEP_EVERY_TICKS === 0) await closeOrphanStreams();

  const options = await radioOptions();
  const enabled = await voiceCallEnabled();

  for (const [key, session] of [...sessions.entries()]) {
    if (session.busy) continue;

    if (!enabled) {
      await stopRadio(Number(key), 'بخش رادیوی ویس‌کال از پنل خاموش شد.');
      continue;
    }

    // ۲) سقف زمانی هر نشست
    if (options.maxMinutes > 0 && Date.now() - session.startedAt > options.maxMinutes * 60_000) {
      await stopRadio(Number(key), `به سقف ${options.maxMinutes} دقیقهٔ رادیو رسید.`);
      continue;
    }

    // ۳) وضعیت واقعی از سرویس بپرس
    const status = await voiceApi.status(session.chatId);
    if (!status.ok) {
      session.failures++;
      session.lastError = status.error || 'سرویس ویس‌کال پاسخ نداد.';
      if (session.failures >= MAX_UNREACHABLE) {
        await stopRadio(session.chatId, `سرویس ویس‌کال پاسخ نمی‌دهد: ${session.lastError}`);
      }
      continue;
    }
    session.failures = 0;

    const state = String(status.data?.status || 'idle');
    if (state === 'playing' || state === 'paused') {
      const stream = status.data?.stream || {};
      if (typeof stream.title === 'string' && stream.title && stream.title !== session.trackTitle) {
        session.trackTitle = stream.title;
        await refreshCard(session);
      }
      continue;
    }

    // ۴) ended/idle/stopped → آهنگ بعدی
    const started = await playTrack(session, 'auto');
    if (!started) {
      await stopRadio(
        session.chatId,
        session.lastError || 'آهنگ بعدی پیدا نشد (کتابخانهٔ موزیک خالی است یا فایل‌ها روی سرور نیستند).'
      );
    }
  }
}

/** پخش‌هایی که سرویس باز می‌شناسد ولی ربات هیچ نشستی برایشان ندارد */
async function closeOrphanStreams(): Promise<void> {
  const result = await voiceApi.streams();
  if (!result.ok) return;
  for (const stream of result.data?.streams ?? []) {
    if (String(stream.status) !== 'playing') continue;
    const chatId = Number(stream.chatId);
    if (!Number.isFinite(chatId) || sessions.has(keyOf(chatId))) continue;
    console.warn(`Closing orphan voice-call stream in chat ${chatId}`);
    await voiceApi.stop(chatId, false).catch(() => undefined);
  }
}

/**
 * حلقهٔ رادیو. مثل زمان‌بندی موزیک از بیرون روشن می‌شود (index.ts بعد از
 * استارت ربات‌ها) تا دو چیز: کارت‌ها به نمونهٔ زندهٔ همان ربات برسند، و هارنس
 * تست بتواند tick را خودش دقیق و بدون زمان‌سنجی صدا بزند.
 */
let radioTimer: NodeJS.Timeout | null = null;

export function startRadioLoop(): void {
  if (radioTimer) return;
  radioTimer = setInterval(() => {
    void tickRadio().catch((error) => console.error('Radio tick error:', error?.message || error));
  }, TICK_MS);
  radioTimer.unref?.();
}

export function stopRadioLoop(): void {
  if (radioTimer) clearInterval(radioTimer);
  radioTimer = null;
}

// ─── دستور /voicecall و دکمه‌ها ──────────────
function isGroup(ctx: Context): boolean {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

/** /voicecall در گروه: ویس‌کال را باز و رادیو را روشن می‌کند */
export async function handleVoiceCallCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (typeof chatId !== 'number' || !isGroup(ctx)) {
    await ctx
      .reply(
        '📻 رادیوی ویس‌کال فقط در گروه کار می‌کند.\n\nربات را به گروه خود اضافه کنید و در گروه /voicecall را بفرستید.'
      )
      .catch(() => undefined);
    return;
  }

  const botId = getBotId(ctx);
  if (!(await voiceCallEnabled())) {
    await flash(ctx, '📻 بخش رادیوی ویس‌کال در پنل خاموش است.');
    return;
  }
  if (!(await isFeatureAllowed(botId, 'voicecall'))) {
    await flash(ctx, '📻 رادیوی ویس‌کال برای این ربات در پنل غیرفعال شده است.');
    return;
  }
  if (!(await getSettingBool('music_enabled'))) {
    await flash(ctx, '🎵 اول بخش موزیک را از پنل روشن کنید؛ رادیو از کتابخانهٔ همان بخش استفاده می‌کند.');
    return;
  }

  const already = sessions.get(keyOf(chatId));
  if (already) {
    await flash(ctx, `📻 رادیو همین حالا روشن است.\n\n🎵 ${already.trackTitle || '—'}\n⏹ برای توقف همان دکمهٔ کارت را بزنید.`);
    return;
  }

  // کارت اول فرستاده می‌شود تا messageId داشته باشد؛ اگر پخش نشد، پاک می‌شود
  let messageId: number | null = null;
  try {
    const sent: any = await ctx.reply('📻 در حال آماده‌کردن ویس‌کال گروه و پخش اولین آهنگ…', {
      ...cardKeyboard(chatId),
    });
    messageId = typeof sent?.message_id === 'number' ? sent.message_id : null;
  } catch {
    /* اجازهٔ ارسال پیام نداریم؛ رادیو بدون کارت هم کار می‌کند */
  }

  const startedBy = ctx.from?.first_name || ctx.from?.username || 'عضو گروه';
  const result = await startRadio({ botId, chatId, startedBy, messageId });

  if (!result.ok) {
    if (messageId) await ctx.telegram.deleteMessage(chatId, messageId).catch(() => undefined);
    if (result.session) return; // از قبل روشن بوده
    await flash(ctx, `❌ رادیو روشن نشد.\n\n${result.error}`);
    return;
  }

  await refreshCard(result.session!);
}

/** دکمه‌های کارت: ⏭ آهنگ بعدی و ⏹ توقف — برای همهٔ اعضای گروه */
export async function handleVoiceCallCallback(ctx: Context, action: 'next' | 'stop'): Promise<void> {
  const chatId = ctx.chat?.id;
  // ctx.match فقط داخل هندل‌کنندهٔ bot.action(/regex/) تایپ دارد؛ اینجا خودِ
  // دادهٔ دکمه را از callbackQuery می‌خوانیم تا مستقل از نحوهٔ صدا زدن کار کند.
  // (union نوع callbackQuery در Telegraf شامل GameQuery است که data ندارد.)
  const data = String((ctx.callbackQuery as any)?.data ?? '');
  const target = Number(data.split(':')[1] ?? '');
  if (typeof chatId !== 'number' || !Number.isFinite(target) || target !== chatId) {
    await ctx.answerCbQuery('❌ این دکمه مربوط به همین گروه نیست.').catch(() => undefined);
    return;
  }

  const session = sessions.get(keyOf(chatId));
  if (!session) {
    await ctx.answerCbQuery('📻 رادیو همین حالا خاموش است.').catch(() => undefined);
    // کارت ماندهٔ نشست قبلی پاک می‌شود تا دکمهٔ بی‌کار در گروه نماند
    const messageId = (ctx.callbackQuery as any)?.message?.message_id;
    if (typeof messageId === 'number') {
      await ctx.telegram.deleteMessage(chatId, messageId).catch(() => undefined);
    }
    return;
  }

  const by = ctx.from?.first_name || ctx.from?.username || 'عضو گروه';

  if (action === 'stop') {
    await ctx.answerCbQuery('⏹ پخش متوقف شد').catch(() => undefined);
    await stopRadio(chatId, `توسط ${by}`);
    return;
  }

  await ctx.answerCbQuery('⏭ در حال پخش آهنگ بعدی…').catch(() => undefined);
  const result = await nextRadioTrack(chatId);
  if (!result.ok) await flash(ctx, `❌ آهنگ بعدی پخش نشد: ${result.error}`);
}

// ─── چیزی که پنل و آمار باید ببینند ─────────
export interface RadioGroupStatus {
  chatId: number;
  botId: number;
  title: string;
  playing: boolean;
  track: string;
  plays: number;
  startedBy: string;
  startedAgoSec: number;
  elapsedSec: number;
  durationSec: number;
  accountId: string | null;
  lastError: string | null;
}

export async function radioGroupStatus(): Promise<RadioGroupStatus[]> {
  const list = radioSessions();
  if (!list.length) return [];

  // نام گروه‌ها از همان جدولی می‌آید که ربات حضورش در گروه‌ها را ثبت می‌کند
  const rows = await prisma.groupChat
    .findMany({
      where: { chatId: { in: list.map((session) => BigInt(session.chatId)) } },
      select: { chatId: true, title: true },
    })
    .catch(() => [] as { chatId: bigint; title: string | null }[]);
  const titles = new Map(rows.map((row) => [String(row.chatId), row.title || '']));

  return list.map((session) => ({
    chatId: session.chatId,
    botId: session.botId,
    title: titles.get(String(session.chatId)) || '',
    playing: !session.busy,
    track: session.trackTitle,
    plays: session.plays,
    startedBy: session.startedBy,
    startedAgoSec: Math.round((Date.now() - session.startedAt) / 1000),
    elapsedSec: Math.round((Date.now() - session.playStartedAt) / 1000),
    durationSec: session.duration,
    accountId: session.accountId,
    lastError: session.lastError,
  }));
}

/** آیا ربات همین حالا در این گروه رادیو روشن کرده است؟ */
export function isRadioOn(chatId: number | string): boolean {
  return sessions.has(keyOf(chatId));
}

export type { VoiceResult };
