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
];

export async function syncCommandMenus(telegram: any) {
  try {
    // Default scope = groups list: if a client falls back to it inside a group,
    // it still only sees /games (private chats are covered by all_private_chats).
    await telegram.setMyCommands(GROUP_COMMANDS);
    // Private chats — full command list
    await telegram.setMyCommands(PRIVATE_COMMANDS, { scope: { type: 'all_private_chats' } });
    // Groups — only /games
    await telegram.setMyCommands(GROUP_COMMANDS, { scope: { type: 'all_group_chats' } });
    // Group admins see the same list
    await telegram.setMyCommands(GROUP_COMMANDS, { scope: { type: 'all_chat_administrators' } });
    console.log('Command menus synced');
  } catch (error: any) {
    console.error('Sync command menus error:', error?.description || error?.message || String(error));
  }
}
