export const DEFAULT_MENU_BUTTONS = [
  { key: 'free_config', label: '🎁 کانفیگ رایگان', color: 'none', sortOrder: 10 },
  { key: 'shop', label: '🛒 فروشگاه', color: 'none', sortOrder: 20 },
  { key: 'proxy', label: '🔐 پروکسی تلگرام', color: 'none', sortOrder: 30 },
  { key: 'referral', label: '👥 زیرمجموعه‌گیری', color: 'none', sortOrder: 40 },
  { key: 'points', label: '💰 امتیازها', color: 'none', sortOrder: 50 },
  { key: 'downloader', label: '📥 دانلودر', color: 'none', sortOrder: 60 },
  { key: 'voice_convert', label: '🎙️ تبدیل ویس', color: 'none', sortOrder: 70 },
  { key: 'word_to_pdf', label: '📄 Word به PDF', color: 'none', sortOrder: 75 },
  { key: 'video_to_mp3', label: '🎬 ویدیو به MP3', color: 'none', sortOrder: 78 },
  { key: 'server_status', label: '📊 وضعیت سرور', color: 'none', sortOrder: 80 },
  { key: 'games', label: '🎮 بازی‌ها', color: 'none', sortOrder: 85 },
  { key: 'support', label: '🎫 پشتیبانی', color: 'none', sortOrder: 90 },
];

export const KNOWN_MENU_KEYS = new Set(DEFAULT_MENU_BUTTONS.map((item) => item.key));

// Telegram Bot API now supports real inline-button colors through the `style`
// field: "danger" (red), "success" (green) and "primary" (blue).
export const MENU_COLORS = ['none', 'danger', 'success', 'primary'] as const;
export type MenuColor = (typeof MENU_COLORS)[number];

// Older installs stored emoji-dot colors. Map them to the closest real color
// so existing menus keep their meaning without a DB migration.
const LEGACY_COLORS: Record<string, MenuColor> = {
  red: 'danger',
  orange: 'danger',
  green: 'success',
  yellow: 'success',
  blue: 'primary',
  purple: 'primary',
};

export function normalizeMenuColor(color?: string | null): MenuColor {
  if (!color) return 'none';
  const value = String(color).trim().toLowerCase();
  if ((MENU_COLORS as readonly string[]).includes(value)) return value as MenuColor;
  return LEGACY_COLORS[value] ?? 'none';
}

export function buttonStyle(color?: string | null): 'danger' | 'success' | 'primary' | undefined {
  const normalized = normalizeMenuColor(color);
  return normalized === 'none' ? undefined : normalized;
}
