import { Context, Telegraf } from 'telegraf';
import { prisma } from './prisma.js';
import { getBotId } from './bot-context.js';
import { telegramIdOf } from './user.js';

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
  downloader: 'downloader',
  voice_convert: 'voice_convert',
  word_to_pdf: 'word_to_pdf',
  video_to_mp3: 'video_to_mp3',
  server_status: 'server_status',
  support: 'support',
};

const COMMAND_FEATURES: Record<string, FeatureKey> = {
  '/free': 'free_config',
  '/proxy': 'proxy',
  '/referral': 'referral',
  '/points': 'points',
  '/checkin': 'points',
  '/download': 'downloader',
  '/voice': 'voice_convert',
  '/status': 'server_status',
  '/support': 'support',
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

  if (msg.voice || msg.audio) return 'voice_convert';
  if (msg.video) return 'video_to_mp3';

  if (msg.document) {
    const name: string = msg.document.file_name || '';
    const mime: string = msg.document.mime_type || '';
    if (mime === 'audio/mpeg' || /\.mp3$/i.test(name)) return 'voice_convert';
    if (WORD_DOC_PATTERN.test(name)) return 'word_to_pdf';
    if (VIDEO_DOC_PATTERN.test(name) || mime.startsWith('video/')) return 'video_to_mp3';
  }

  return undefined;
}

export function registerFeatureGuard(bot: Telegraf) {
  bot.use(async (ctx, next) => {
    const key = featureKeyForCtx(ctx);
    if (!key) return next();

    const user = await prisma.user.findUnique({
      where: {
        botId_telegramId: { botId: getBotId(ctx), telegramId: telegramIdOf(ctx) },
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
