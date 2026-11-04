/**
 * تصمیم پخش: پیام صوتی در چت یا استریم در ویس‌کال گروه.
 *
 * تنظیم سراسری music_voice_enabled کل قابلیت را روشن/خاموش می‌کند. هر گروه
 * می‌تواند در پنل حالت خودش را داشته باشد (group_chats.music_mode):
 *   default → از music_voice_default_mode پیروی می‌کند
 *   chat    → پیام صوتی در چت (روش کلاسیک، فقط با ربات)
 *   voice   → استریم در ویس‌کال با حساب تلگرام کاربری
 *
 * اگر پخش در ویس‌کال به هر دلیلی نشد (حسابی وارد نشده، ویس‌کال گروه بسته است،
 * فایل روی سرور نیست) ربات به همان روش چت برمی‌گردد تا شنونده بی‌صدا نماند،
 * و دلیلش را در یک پیام ۱۰ ثانیه‌ای می‌گوید.
 */
import { prisma } from './prisma.js';
import { getSetting, getSettingBool, getSettingNumber } from './settings.js';
import { voiceApi, type VoiceResult } from './voice-client.js';

export type PlaybackMode = 'chat' | 'voice';

const QUALITIES = new Set(['low', 'medium', 'high', 'studio']);

export async function voiceFeatureEnabled(): Promise<boolean> {
  return getSettingBool('music_voice_enabled');
}

export async function resolvePlaybackMode(botId: number, chatId: number): Promise<PlaybackMode> {
  if (!(await voiceFeatureEnabled())) return 'chat';

  let mode = 'default';
  try {
    const group = await prisma.groupChat.findUnique({
      where: { botId_chatId: { botId, chatId: BigInt(chatId) } },
      select: { musicMode: true },
    });
    mode = group?.musicMode || 'default';
  } catch {
    /* گروهی که هنوز در جدول نیست: حالت پیش‌فرض سراسری */
  }
  if (mode === 'voice') return 'voice';
  if (mode === 'chat') return 'chat';

  const fallback = ((await getSetting('music_voice_default_mode')) || 'chat').toLowerCase();
  return fallback === 'voice' ? 'voice' : 'chat';
}

export interface VoicePlayOptions {
  quality: string;
  autoStart: boolean;
  maxStreams: number;
}

/** تنظیمات پخش که از پنل خوانده می‌شود (با پیش‌فرض امن) */
export async function voicePlayOptions(): Promise<VoicePlayOptions> {
  const rawAutoStart = await getSetting('music_voice_auto_start');
  const rawQuality = ((await getSetting('music_voice_quality')) || 'high').toLowerCase();
  const configuredStreams = await getSettingNumber('music_voice_max_streams');
  return {
    // اگر تنظیمی هنوز ساخته نشده، روشن باشد بهتر است: کاربر ویس‌کال باز را
    // خودش در پنل انتخاب کرده است
    autoStart: rawAutoStart === null ? true : rawAutoStart === 'true',
    quality: QUALITIES.has(rawQuality) ? rawQuality : 'high',
    maxStreams: configuredStreams > 0 ? Math.min(configuredStreams, 20) : 5,
  };
}

/** آیا دست کم یک حساب تلگرام آمادهٔ پخش هست؟ */
export async function hasVoiceAccount(): Promise<boolean> {
  return voiceApi.hasReadyAccount();
}

export interface VoicePlayInput {
  chatId: number;
  path: string;
  title?: string;
  duration?: number;
}

/**
 * استریم یک آهنگ در ویس‌کال گروه. نتیجه همان {ok, error} کلاینت است تا
 * فراخوان بتواند دلیل فارسی را نشان دهد یا به چت برگردد.
 */
export async function streamInVoiceCall(input: VoicePlayInput): Promise<VoiceResult<any>> {
  const options = await voicePlayOptions();
  return voiceApi.play({
    chatId: input.chatId,
    path: input.path,
    title: input.title,
    duration: input.duration ?? 0,
    quality: options.quality,
    autoStart: options.autoStart,
    maxStreams: options.maxStreams,
  });
}

/** وضعیت پخش یک گروه؛ اگر سرویس در دسترس نبود null می‌دهد (پلیر روی چت عمل می‌کند) */
export async function voiceStatusFor(chatId: number): Promise<string | null> {
  const result = await voiceApi.status(chatId);
  if (!result.ok) return null;
  return String(result.data?.status || 'idle');
}

export async function stopVoiceCall(chatId: number): Promise<void> {
  await voiceApi.stop(chatId);
}
