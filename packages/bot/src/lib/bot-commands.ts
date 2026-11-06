import { isFeatureAllowed, isGameAllowed } from './bot-access.js';

// ─── Telegram Command Menus (shared) ─────────
// هر ربات در پنل می‌تواند فهرست قابلیت‌ها و بازی‌هایی که مجاز نیست را داشته
// باشد؛ دستورهای همان ربات هم بر همان اساس ساخته می‌شوند تا کاربر دستوری را
// نبیند که ربات قبول نمی‌کند.

export const PRIVATE_COMMANDS = [
  { command: 'start', description: 'شروع ربات و منوی اصلی' },
  { command: 'menu', description: 'منوی اصلی' },
  { command: 'games', description: 'بازی‌ها' },
  { command: 'free', description: 'دریافت کانفیگ رایگان' },
  { command: 'proxy', description: 'دریافت پروکسی' },
  { command: 'points', description: 'امتیازهای من' },
  { command: 'checkin', description: 'امتیاز روزانه' },
  { command: 'reward', description: 'گرفتن کانفیگ با امتیاز' },
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
  { command: 'mench', description: 'شروع بازی منچ' },
  { command: 'scala', description: 'شروع بازی اسکالا' },
  { command: 'joraat', description: 'شروع جرعت و حقیقت' },
  { command: 'music', description: 'پخش تصادفی یک آهنگ به‌شکل ویس' },
  { command: 'play', description: 'پخش تصادفی یک آهنگ به‌شکل ویس' },
  { command: 'voicecall', description: 'روشن‌کردن رادیوی موزیک در ویس‌کال گروه' },
];

/** هر دستور به کدام کلید دسترسی وابسته است؛ نبودِ کلید یعنی همیشه آزاد */
const COMMAND_FEATURE: Record<string, string> = {
  free: 'free_config',
  proxy: 'proxy',
  points: 'points',
  checkin: 'points',
  reward: 'points',
  referral: 'referral',
  support: 'support',
  download: 'downloader',
  voice: 'voice_convert',
  status: 'server_status',
  music: 'music',
  play: 'music',
  voicecall: 'voicecall',
};

const COMMAND_GAME: Record<string, string> = {
  games: '',
  meen: 'minesweeper',
  dooz: 'tic_tac_toe',
  kalame: 'wordle',
  hokm: 'hokm',
  mench: 'mench',
  scala: 'scala',
  joraat: 'truth_or_dare',
};

/**
 * فهرست دستورهای مجاز برای یک ربات.
 * `botId` اختیاری است: بدون آن هیچ فیلتری اعمال نمی‌شود (برای تست و نصب‌هایی
 * که هنوز ستون دسترسی‌ها را ندارند).
 */
export async function allowedCommands(
  commands: Array<{ command: string; description: string }>,
  botId?: number
): Promise<Array<{ command: string; description: string }>> {
  if (!botId) return [...commands];

  const out: Array<{ command: string; description: string }> = [];
  for (const item of commands) {
    const name = item.command.replace(/^\//, '').toLowerCase();
    const feature = COMMAND_FEATURE[name];
    if (feature && !(await isFeatureAllowed(botId, feature))) continue;

    const game = COMMAND_GAME[name];
    if (game === '') {
      // «/games» خودش بخش بازی‌هاست؛ با blockedFeatures:games خاموش می‌شود
      if (!(await isFeatureAllowed(botId, 'games'))) continue;
    } else if (game && !(await isGameAllowed(botId, game))) {
      continue;
    }

    out.push(item);
  }
  return out;
}

// Register for the default (language-less) list plus fa/en explicitly.
// Some clients request the menu with their language code and cache it per language.
const MENU_LANGUAGES = ['', 'fa', 'en'];

export async function syncCommandMenus(telegram: any, botId?: number) {
  try {
    const [groupCommands, privateCommands] = await Promise.all([
      allowedCommands(GROUP_COMMANDS, botId),
      allowedCommands(PRIVATE_COMMANDS, botId),
    ]);

    for (const language of MENU_LANGUAGES) {
      const langExtra = language ? { language_code: language } : {};
      // Default scope = groups list: if a client falls back to it inside a group,
      // it still only sees the group commands (private chats are covered by all_private_chats).
      await telegram.setMyCommands(groupCommands, { ...langExtra });
      // Private chats — full command list
      await telegram.setMyCommands(privateCommands, {
        scope: { type: 'all_private_chats' },
        ...langExtra,
      });
      // Groups — /games + direct game commands
      await telegram.setMyCommands(groupCommands, {
        scope: { type: 'all_group_chats' },
        ...langExtra,
      });
      // Group admins see the same list
      await telegram.setMyCommands(groupCommands, {
        scope: { type: 'all_chat_administrators' },
        ...langExtra,
      });
    }
    console.log(`Command menus synced${botId ? ` for bot ${botId}` : ''}`);
  } catch (error: any) {
    console.error('Sync command menus error:', error?.description || error?.message || String(error));
  }
}
