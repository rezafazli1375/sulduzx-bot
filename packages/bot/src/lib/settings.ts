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
  {
    key: 'ytdlp_proxy_mode',
    value: 'off',
    type: 'STRING',
    description: 'حالت پروکسی دانلودر: off, socks, v2ray',
  },
  {
    key: 'ytdlp_v2ray_config',
    value: '',
    type: 'STRING',
    description: 'کانفیگ V2Ray دانلودر (vless://, vmess://, trojan://, ss:// یا JSON)',
  },
  {
    key: 'games_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'بخش بازی‌ها فعال',
  },
  {
    key: 'games_private_vs_bot_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'بازی در گفتگوی خصوصی با خودِ ربات (دوز، مین‌روب، جرعت و حقیقت)',
  },
  {
    key: 'game_truth_or_dare_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'بازی جرعت و حقیقت فعال',
  },
  {
    key: 'game_truth_or_dare_nsfw',
    value: 'true',
    type: 'BOOLEAN',
    description: 'دستهٔ «+۱۸» در جرعت و حقیقت؛ خاموش یعنی فقط سؤال‌های معمولی پرسیده می‌شود',
  },
  {
    key: 'game_tic_tac_toe_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'بازی دوز فعال',
  },
  {
    key: 'game_tic_tac_toe_bot_difficulty',
    value: 'normal',
    type: 'STRING',
    description: 'سختی ربات در دوزِ پیوی: easy، normal یا hard',
  },
  {
    key: 'game_minesweeper_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'بازی مین‌روب فعال',
  },
  {
    key: 'game_minesweeper_bot_difficulty',
    value: 'normal',
    type: 'STRING',
    description: 'سختی ربات در مین‌روبِ پیوی: easy، normal یا hard',
  },
  {
    key: 'fortune_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'دکمهٔ «فال روز» در منوی اصلی فعال',
  },
  {
    key: 'fortune_points',
    value: '2',
    type: 'NUMBER',
    description: 'امتیاز دیدن فال روز (۰ یعنی امتیازی ندهد)',
  },
  {
    key: 'music_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'پخش موزیک در گروه فعال',
  },
  {
    key: 'music_user_songs',
    value: 'true',
    type: 'BOOLEAN',
    description: 'کاربران بتوانند با فرستادن آهنگ در گروه، آن را به کتابخانه اضافه کنند',
  },
  {
    key: 'music_max_mb',
    value: '25',
    type: 'NUMBER',
    description: 'حداکثر حجم آهنگ (مگابایت) — هم آپلود از پنل هم آهنگی که کاربر در گروه می‌فرستد',
  },
  {
    key: 'music_schedule_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'پخش خودکار موزیک در ساعت‌های تعیین‌شده (بخش موزیک پنل) فعال',
  },
  {
    key: 'reward_points_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'خرج کردن امتیاز و گرفتن کانفیگ از بخش امتیازهای ربات',
  },
  {
    key: 'reward_notice_enabled',
    value: 'true',
    type: 'BOOLEAN',
    description: 'وقتی امتیاز کاربر به حد نصاب یک پاداش رسید، در پیوی به او خبر داده شود',
  },
  {
    key: 'backup_telegram_chat_id',
    value: '',
    type: 'STRING',
    description: 'شناسهٔ عددی تلگرام برای ارسال خودکار بکاپ',
  },
  {
    key: 'backup_bot_id',
    value: '',
    type: 'NUMBER',
    description: 'شناسهٔ رباتی که بکاپ را ارسال می‌کند',
  },
  {
    key: 'backup_auto_send',
    value: 'false',
    type: 'BOOLEAN',
    description: 'ارسال خودکار بکاپ بعد از ساخت',
  },
  {
    key: 'backup_auto_enabled',
    value: 'false',
    type: 'BOOLEAN',
    description: 'بکاپ خودکار زمان‌بندی‌شده فعال',
  },
  {
    key: 'backup_auto_interval',
    value: 'daily',
    type: 'STRING',
    description: 'بازهٔ بکاپ خودکار: daily, weekly, monthly, custom',
  },
  {
    key: 'backup_auto_custom_hours',
    value: '24',
    type: 'NUMBER',
    description: 'اگر بازه custom باشد، هر هر چند ساعت یک‌بار',
  },
  {
    key: 'backup_auto_time',
    value: '03:00',
    type: 'STRING',
    description: 'ساعت اجرای بکاپ خودکار (HH:MM)',
  },
  {
    key: 'backup_auto_retention',
    value: '20',
    type: 'NUMBER',
    description: 'تعداد بکاپ‌هایی که نگهداری می‌شوند (قدیمی‌ترها پاک می‌شوند)',
  },
  {
    key: 'backup_last_run_at',
    value: '',
    type: 'STRING',
    description: 'زمان آخرین اجرای بکاپ خودکار (ISO)',
  },
  {
    key: 'backup_next_run_at',
    value: '',
    type: 'STRING',
    description: 'زمان اجرای بعدی بکاپ خودکار (ISO)',
  },
];

/**
 * تنظیماتی که در نسخه‌های بعدی حذف شده‌اند.
 * در نصب‌های قدیمی سطرهایشان در دیتابیس می‌ماند و در صفحهٔ تنظیمات دیده می‌شود،
 * پس هنگام بالا آمدن ربات پاک می‌شوند.
 *
 * ۱٫۹٫۰ — نخستین حذف پخش در ویس‌کال
 * ۲٫۰٫۰ — حذف کامل رادیوی ویس‌کال و چهار بازی (کلمه‌یاب، حکم، منچ، اسکالا)
 */
export const REMOVED_SETTINGS = [
  'music_voice_enabled',
  'music_voice_default_mode',
  'music_voice_auto_start',
  'music_voice_max_streams',
  'music_voice_quality',
  'voicecall_enabled',
  'voicecall_quality',
  'voicecall_volume',
  'voicecall_max_minutes',
  'voicecall_max_streams',
  'voicecall_auto_start',
  'voicecall_account',
  'game_hokm_enabled',
  'game_wordle_enabled',
  'game_wordle_length',
  'game_mench_enabled',
  'game_scala_enabled',
];

export async function ensureDefaultSettings(): Promise<void> {
  let created = false;

  // تنظیمات حذف‌شدهٔ نسخه‌های قبلی از دیتابیس بیرون روند تا در پنل نمانند
  if (REMOVED_SETTINGS.length) {
    const removed = await prisma.setting
      .deleteMany({ where: { key: { in: REMOVED_SETTINGS } } })
      .catch(() => null);
    if (removed && removed.count > 0) clearSettingsCache();
  }

  for (const setting of REQUIRED_DEFAULTS) {
    const existing = await prisma.setting.findUnique({ where: { key: setting.key } });
    if (existing) continue;

    const data = { ...setting };

    // Carry over the legacy on/off + URL pair so existing installs keep working.
    if (setting.key === 'ytdlp_proxy_mode') {
      const legacyEnabled = await prisma.setting.findUnique({ where: { key: 'ytdlp_proxy_enabled' } });
      const legacyUrl = await prisma.setting.findUnique({ where: { key: 'ytdlp_proxy_url' } });
      if (legacyEnabled?.value === 'true' && (legacyUrl?.value || '').trim()) {
        data.value = 'socks';
      }
    }

    await prisma.setting.create({ data });
    created = true;
  }

  if (created) clearSettingsCache();
}

export function clearSettingsCache(): void {
  cache.clear();
}
