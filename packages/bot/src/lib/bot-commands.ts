// ─── Telegram Command Menus (shared) ─────────
export const PRIVATE_COMMANDS = [
  { command: 'start', description: 'شروع ربات و منوی اصلی' },
  { command: 'menu', description: 'منوی اصلی' },
  { command: 'games', description: 'بازی‌ها' },
  { command: 'free', description: 'دریافت کانفیگ رایگان' },
  { command: 'proxy', description: 'دریافت پروکسی' },
  { command: 'points', description: 'امتیازهای من' },
  { command: 'checkin', description: 'امتیاز روزانه' },
  { command: 'referral', description: 'دعوت دوستان' },
  { command: 'support', description: 'پشتیبانی' },
  { command: 'download', description: 'دانلود از اینستاگرام و یوتیوب' },
  { command: 'voice', description: 'تبدیل ویس و ویدیو' },
  { command: 'status', description: 'وضعیت سرورها' },
];

export const GROUP_COMMANDS = [
  { command: 'games', description: 'منوی بازی‌های ربات' },
  { command: 'meen', description: 'شروع بازی مین‌روب' },
  { command: 'dooz', description: 'شروع بازی دوز' },
  { command: 'kalame', description: 'شروع بازی کلمه‌یاب' },
  { command: 'hokm', description: 'شروع بازی حکم' },
  { command: 'joraat', description: 'شروع جرعت و حقیقت' },
];

// Register for the default (language-less) list plus fa/en explicitly.
// Some clients request the menu with their language code and cache it per language.
const MENU_LANGUAGES = ['', 'fa', 'en'];

export async function syncCommandMenus(telegram: any) {
  try {
    for (const language of MENU_LANGUAGES) {
      const langExtra = language ? { language_code: language } : {};
      // Default scope = groups list: if a client falls back to it inside a group,
      // it still only sees the group commands (private chats are covered by all_private_chats).
      await telegram.setMyCommands(GROUP_COMMANDS, { ...langExtra });
      // Private chats — full command list
      await telegram.setMyCommands(PRIVATE_COMMANDS, {
        scope: { type: 'all_private_chats' },
        ...langExtra,
      });
      // Groups — /games + direct game commands
      await telegram.setMyCommands(GROUP_COMMANDS, {
        scope: { type: 'all_group_chats' },
        ...langExtra,
      });
      // Group admins see the same list
      await telegram.setMyCommands(GROUP_COMMANDS, {
        scope: { type: 'all_chat_administrators' },
        ...langExtra,
      });
    }
    console.log('Command menus synced');
  } catch (error: any) {
    console.error('Sync command menus error:', error?.description || error?.message || String(error));
  }
}
