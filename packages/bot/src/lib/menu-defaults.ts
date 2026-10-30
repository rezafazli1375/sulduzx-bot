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
  { key: 'support', label: '🎫 پشتیبانی', color: 'none', sortOrder: 90 },
];

export const KNOWN_MENU_KEYS = new Set(DEFAULT_MENU_BUTTONS.map((item) => item.key));

export const MENU_COLORS = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;

export const COLOR_DOTS: Record<string, string> = {
  red: '🔴',
  orange: '🟠',
  yellow: '🟡',
  green: '🟢',
  blue: '🔵',
  purple: '🟣',
};

export function colorPrefix(color?: string): string {
  const dot = color ? COLOR_DOTS[color] : '';
  return dot ? `${dot} ` : '';
}
