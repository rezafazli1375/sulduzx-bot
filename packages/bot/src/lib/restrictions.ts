import { Context, Telegraf } from 'telegraf';
import { prisma } from './prisma.js';
import { getBotId } from './bot-context.js';
import { telegramIdOf } from './user.js';
// چرخهٔ import با bot-access عمدی است: هر دو طرف فقط داخل بدنهٔ توابع استفاده
// می‌شوند، نه در زمان بارشدن ماژول، پس چرخه مشکلی نمی‌سازد.
import { isFeatureAllowed } from './bot-access.js';

export const FEATURE_KEYS = [
  'free_config',
  'shop',
  'proxy',
  'referral',
  'points',
  'downloader',
  'voice_convert',
  'word_to_pdf',
  'video_to_mp3',
  'server_status',
  'support',
  'music',
  'voicecall',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  free_config: 'دریافت کانفیگ رایگان',
  shop: 'فروشگاه',
  proxy: 'پروکسی تلگرام',
  referral: 'زیرمجموعه‌گیری',
  points: 'امتیازها',
  downloader: 'دانلودر',
  voice_convert: 'تبدیل ویس',
  word_to_pdf: 'Word به PDF',
  video_to_mp3: 'ویدیو به MP3',
  server_status: 'وضعیت سرور',
  support: 'پشتیبانی',
  music: 'پخش موزیک در گروه',
  voicecall: 'رادیو در ویس‌کال گروه',
};

export const BLOCKED_NOTICE = '⛔️ دسترسی شما به این بخش توسط مدیریت محدود شده است.';

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function isFeatureBlocked(
  user: { blockedFeatures?: string[] | null } | null | undefined,
  key: string
): boolean {
  return Array.isArray(user?.blockedFeatures) && user!.blockedFeatures!.includes(key);
}

const CALLBACK_FEATURES: Record<string, FeatureKey> = {
  free_config: 'free_config',
  confirm_free_config: 'free_config',
  shop: 'shop',
  shop_item: 'shop',
  proxy: 'proxy',
  referral: 'referral',
  points: 'points',
  daily_checkin: 'points',
  reward: 'points',
  downloader: 'downloader',
  voice_convert: 'voice_convert',
  word_to_pdf: 'word_to_pdf',
  video_to_mp3: 'video_to_mp3',
  server_status: 'server_status',
  support: 'support',
  music: 'music',
  vc_next: 'voicecall',
  vc_stop: 'voicecall',
};

const COMMAND_FEATURES: Record<string, FeatureKey> = {
  '/free': 'free_config',
  '/proxy': 'proxy',
  '/referral': 'referral',
  '/points': 'points',
  '/checkin': 'points',
  '/reward': 'points',
  '/download': 'downloader',
  '/voice': 'voice_convert',
  '/status': 'server_status',
  '/support': 'support',
  '/music': 'music',
  '/play': 'music',
  '/voicecall': 'voicecall',
};

const WORD_DOC_PATTERN = /\.(docx?|odt|rtf)$/i;
const VIDEO_DOC_PATTERN = /\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|3gp)$/i;

export function featureKeyForCtx(ctx: Context): FeatureKey | undefined {
  const callbackData = (ctx as any).callbackQuery?.data as string | undefined;
  if (callbackData) {
    return CALLBACK_FEATURES[callbackData.split(':')[0]];
  }

  const msg = (ctx as any).message;
  if (!msg) return undefined;

  if (typeof msg.text === 'string') {
    const text = msg.text.trim();
    if (text.startsWith('/')) {
      return COMMAND_FEATURES[text.split(/[\s@]/)[0].toLowerCase()];
    }
    if (/^https?:\/\//i.test(text) && /(instagram\.com|youtube\.com|youtu\.be)/i.test(text)) {
      return 'downloader';
    }
    return undefined;
  }

  // ویس/آهنگ در پیوی = تبدیل ویس؛ در گروه = درخواست پخش موزیک
  const inGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  if (msg.audio) return inGroup ? 'music' : 'voice_convert';
  if (msg.voice) return 'voice_convert';
  if (msg.video) return 'video_to_mp3';

  if (msg.document) {
    const name: string = msg.document.file_name || '';
    const mime: string = msg.document.mime_type || '';
    if (mime === 'audio/mpeg' || /\.mp3$/i.test(name)) return inGroup ? 'music' : 'voice_convert';
    if (WORD_DOC_PATTERN.test(name)) return 'word_to_pdf';
    if (VIDEO_DOC_PATTERN.test(name) || mime.startsWith('video/')) return 'video_to_mp3';
  }

  return undefined;
}

export function registerFeatureGuard(bot: Telegraf) {
  bot.use(async (ctx, next) => {
    const key = featureKeyForCtx(ctx);
    if (!key) return next();

    // لایهٔ ربات: در پنل، بخش «ربات‌ها» تعیین می‌کند هر ربات اصلاً به کدام
    // بخش‌ها دسترسی داشته باشد. این محدودیت از محدودیت کاربر عمومی‌تر است و
    // پیش‌تر بررسی می‌شود (از کش می‌خواند).
    const botId = getBotId(ctx);
    if (!(await isFeatureAllowed(botId, key))) {
      if ((ctx as any).callbackQuery) {
        await ctx
          .answerCbQuery('⛔️ این بخش برای این ربات در پنل غیرفعال شده است', { show_alert: true })
          .catch(() => undefined);
        return;
      }
      await ctx
        .reply('⛔️ این بخش برای این ربات توسط مدیریت غیرفعال شده است.')
        .catch(() => undefined);
      return;
    }

    const user = await prisma.user.findUnique({
      where: {
        botId_telegramId: { botId, telegramId: telegramIdOf(ctx) },
      },
      select: { blockedFeatures: true, isBlocked: true },
    });

    if (user?.isBlocked) {
      await ctx.reply('⛔️ شما مسدود شده‌اید.').catch(() => undefined);
      return;
    }

    if (!isFeatureBlocked(user, key)) return next();

    if ((ctx as any).callbackQuery) {
      await ctx.answerCbQuery('⛔️ دسترسی محدود شده است', { show_alert: true }).catch(() => undefined);
      return;
    }

    await ctx.reply(BLOCKED_NOTICE).catch(() => undefined);
  });
}
