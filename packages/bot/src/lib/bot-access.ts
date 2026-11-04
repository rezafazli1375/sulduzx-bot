import { prisma } from './prisma.js';
import { FEATURE_KEYS, type FeatureKey } from './restrictions.js';

// ─── سطح دسترسی هر ربات ──────────────────────
// هر رباتی که در پنل ثبت می‌شود می‌تواند فهرست قابلیت‌ها و بازی‌هایی را که
// **مجاز** به استفاده از آن‌ها نیست داشته باشد. این فهرست‌ها روی ردیف خودِ ربات
// (bots.blocked_features و bots.blocked_games) ذخیره می‌شوند؛ فهرست خالی یعنی
// همه‌چیز آزاد، پس ربات‌های قدیمی بدون هیچ تغییری همان‌طور کار می‌کنند.
//
// این لایه در کنار تنظیم‌های سراسری (*_enabled) کار می‌کند: تنظیم سراسری یک
// بخش را برای همهٔ ربات‌ها خاموش می‌کند و فهرست ربات همان بخش را فقط برای یک
// ربات خاموش می‌کند.

export const GAME_IDS = [
  'truth_or_dare',
  'tic_tac_toe',
  'minesweeper',
  'wordle',
  'hokm',
  'mench',
  'scala',
] as const;

export type GameId = (typeof GAME_IDS)[number];

/** کلید منوی «بازی‌ها»؛ جدا از بازی‌های تک‌تک */
export const GAMES_SECTION = 'games';

const GAME_ID_SET = new Set<string>(GAME_IDS);
// restrictions.ts این module را صدا می‌زند، پس لیست کلیدها تنبل ساخته می‌شود تا
// هنگام import دایره‌ای مقدارش هنوز تعریف نشده نباشد
let featureIdSet: Set<string> | null = null;
function featureIds(): Set<string> {
  if (!featureIdSet) featureIdSet = new Set<string>([...FEATURE_KEYS, GAMES_SECTION]);
  return featureIdSet;
}

interface BotAccess {
  features: string[];
  games: string[];
}

const FULL_ACCESS: BotAccess = { features: [], games: [] };

const cache = new Map<number, { access: BotAccess; expires: number }>();
/** پنل بعد از هر ذخیره این کش را پاک می‌کند، پس TTL فقط ضامن تازه‌ماندن است */
const CACHE_TTL_MS = 5 * 60_000;

export function clearBotAccessCache(botId?: number): void {
  if (typeof botId === 'number') cache.delete(botId);
  else cache.clear();
}

async function accessOf(botId: number): Promise<BotAccess> {
  const cached = cache.get(botId);
  if (cached && cached.expires > Date.now()) return cached.access;

  let access = FULL_ACCESS;
  try {
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: { blockedFeatures: true, blockedGames: true },
    });
    if (bot) {
      access = {
        features: Array.isArray(bot.blockedFeatures) ? bot.blockedFeatures : [],
        games: Array.isArray(bot.blockedGames) ? bot.blockedGames : [],
      };
    }
  } catch (error: any) {
    // اگر ستون‌ها هنوز در این نصب ساخته نشده بودند، دسترسی کامل در نظر گرفته
    // می‌شود تا ربات از کار بیفتد
    console.error('Bot access lookup error:', error?.message || error);
    access = FULL_ACCESS;
  }

  cache.set(botId, { access, expires: Date.now() + CACHE_TTL_MS });
  return access;
}

export function isFeatureId(value: string): value is FeatureKey | typeof GAMES_SECTION {
  return featureIds().has(value);
}

export function isGameId(value: string): value is GameId {
  return GAME_ID_SET.has(value);
}

/** آیا این ربات مجاز است از این قابلیت استفاده کند؟ */
export async function isFeatureAllowed(botId: number, key: string): Promise<boolean> {
  if (!key) return true;
  const access = await accessOf(botId);
  return !access.features.includes(key);
}

/** آیا این ربات مجاز است این بازی را نشان دهد/شروع کند؟ */
export async function isGameAllowed(botId: number, game: string): Promise<boolean> {
  if (!game) return true;
  // «بازی‌ها» به‌عنوان بخش، همهٔ بازی‌ها را با هم خاموش می‌کند
  if (!(await isFeatureAllowed(botId, GAMES_SECTION))) return false;
  const access = await accessOf(botId);
  return !access.games.includes(game);
}

export async function blockedFeaturesOf(botId: number): Promise<string[]> {
  return (await accessOf(botId)).features;
}

export async function blockedGamesOf(botId: number): Promise<string[]> {
  return (await accessOf(botId)).games;
}

/** پاک‌کردن کلیدهای ناشناخته از ورودی پنل (تا چیزی که معنا ندارد ذخیره نشود) */
export function normalizeBlockedFeatures(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((item) => String(item).trim()).filter(isFeatureId)));
}

export function normalizeBlockedGames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((item) => String(item).trim()).filter(isGameId)));
}
