import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { getSettingBool } from '../../lib/settings.js';
import { getBotId } from '../../lib/bot-context.js';
import { findUserByCtx } from '../../lib/user.js';
import { mainMenuKeyboard } from '../../lib/ui.js';

// ─── Group Check ─────────────────────────────
export async function requireGroup(ctx: Context, gameName: string): Promise<boolean> {
  const chatType = ctx.chat?.type;
  if (chatType === 'private') {
    const botInfo = await ctx.telegram.getMe();
    await ctx.reply(
      `🎮 *بازی ${gameName}*\n\n` +
      `این بازی فقط در *گروه* قابل انجام است!\n\n` +
      `📌 لطفاً ربات @${botInfo.username} را به گروه خود اضافه کنید و سپس بازی را شروع کنید.\n\n` +
      `💡 برای اضافه کردن ربات به گروه:\n` +
      `1️⃣ وارد گروه شوید\n` +
      `2️⃣ به تنظیمات گروه بروید\n` +
      `3️⃣ Add Members را بزنید\n` +
      `4️⃣ @${botInfo.username} را جستجو و اضافه کنید`,
      { parse_mode: 'Markdown', ...await mainMenuKeyboard() }
    );
    return false;
  }
  return true;
}

// ─── Group message ledger & cleanup ──────────
// هر بازی که داخل گروه پیام می‌فرستد، شناسهٔ همان پیام‌ها را در یک «دفتر» ثبت
// می‌کند. وقتی بازی تمام یا لغو شد، دفتر تخلیه می‌شود: پیام نتیجه مدت کوتاهی
// روی صفحه می‌ماند تا بازیکنان بخوانندش، سپس همهٔ پیام‌های آن بازی از گروه
// پاک می‌شوند تا گروه پر از تخته‌های مرده و پیام‌های تکراری نشود.
// اگر ربات اجازهٔ حذف پیام را نداشته باشد، لااقل دکمه‌های مرده از روی پیام
// برداشته می‌شود تا کسی روی خانه‌های بازی قبلی کلیک نکند.

/** فاصلهٔ اعلام نتیجه تا پاک‌سازی پیام‌ها */
export const GAME_RESULT_PURGE_DELAY_MS = 90_000;
/** لغو بازی: پیام‌ها زودتر پاک می‌شوند */
export const GAME_CANCEL_PURGE_DELAY_MS = 15_000;
/** بازی رهاشده: اگر دو ساعت روی همان پیام دست نخورد، خودش پاک می‌شود */
export const GAME_ABANDONED_AFTER_MS = 2 * 3600_000;

interface GameLedger {
  chatId: number;
  messages: Set<number>;
  touchedAt: number;
  telegram?: any;
}

const ledgers = new Map<string, GameLedger>();

export function trackGameMessage(
  key: string,
  chatId: number,
  messageId: number,
  telegram?: any
): void {
  const ledger = ledgers.get(key);
  if (ledger) {
    ledger.messages.add(messageId);
    ledger.touchedAt = Date.now();
    if (telegram) ledger.telegram = telegram;
    return;
  }
  ledgers.set(key, { chatId, messages: new Set([messageId]), touchedAt: Date.now(), telegram });
}

/**
 * خیلی از بازی‌ها پیامِ همان دکمه‌ای را که «شروع بازی» روی آن بود به‌عنوان تخته
 * استفاده می‌کنند؛ آن پیام هم باید در دفتر ثبت شود تا در پایان پاک شود.
 */
export function trackCallbackMessage(key: string, ctx: Context): void {
  const msg = (ctx.callbackQuery as any)?.message;
  const chatId = msg?.chat?.id ?? ctx.chat?.id;
  const messageId = msg?.message_id;
  if (typeof chatId === 'number' && typeof messageId === 'number') {
    trackGameMessage(key, chatId, messageId, ctx.telegram);
  }
}

/** پیام ربات در گروه؛ شناسه‌اش خودکار در دفتر ثبت می‌شود */
export async function sendGameMessage(
  ctx: Context,
  key: string,
  text: string,
  extra?: any
): Promise<number | undefined> {
  const chatId = ctx.chat?.id;
  if (typeof chatId !== 'number') return undefined;
  try {
    const msg: any = await ctx.reply(text, extra);
    const messageId = msg?.message_id;
    if (typeof messageId === 'number') trackGameMessage(key, chatId, messageId, ctx.telegram);
    return messageId;
  } catch {
    return undefined;
  }
}

/** پیام‌هایی که برای این بازی در گروه ثبت شده (برای گزارش و تست) */
export function gameMessageIds(key: string): number[] {
  return Array.from(ledgers.get(key)?.messages ?? []);
}

/**
 * ارسال پیام بازی در یک چتِ *مشخص* و ثبت آن در دفتر.
 * بازی‌هایی که دکمه‌هایشان در گفتگوی خصوصی فشار داده می‌شود (مثل حکم) باید
 * پیام گروه را به شناسهٔ گروه بفرستند، نه به چت جاری؛ این تابع برای همین است.
 */
export async function postGameMessage(
  telegram: any,
  key: string,
  chatId: number,
  text: string,
  extra?: any
): Promise<number | undefined> {
  if (!telegram || typeof chatId !== 'number') return undefined;
  try {
    const msg: any = await telegram.sendMessage(chatId.toString(), text, extra);
    const messageId = msg?.message_id;
    if (typeof messageId === 'number') trackGameMessage(key, chatId, messageId, telegram);
    return messageId;
  } catch {
    return undefined;
  }
}

/**
 * حذف یکی از پیام‌های بازی و بیرون آوردنش از دفتر.
 * اگر ربات اجازهٔ حذف نداشته باشد، دکمه‌های همان پیام برداشته می‌شود.
 * true یعنی پیام واقعاً حذف شد.
 */
export async function deleteGameMessage(
  telegram: any,
  key: string,
  chatId: number,
  messageId: number
): Promise<boolean> {
  ledgers.get(key)?.messages.delete(messageId);
  if (!telegram || typeof messageId !== 'number' || messageId <= 0) return false;

  try {
    await telegram.deleteMessage(chatId, messageId);
    return true;
  } catch {
    try {
      await telegram.editMessageReplyMarkup(chatId, messageId, undefined);
    } catch {}
    return false;
  }
}

export function dropGameLedger(key: string): void {
  ledgers.delete(key);
}

/**
 * پاک‌سازی پیام‌های یک بازی.
 * دفتر *همین حالا* از بازی جدا می‌شود و بعد از مدت انتظار پاک می‌گردد. اگر
 * بازی جدیدی روی همان کلید شروع شود، پیام‌هایش هرگز پاک نخواهد شد.
 * `delayMs` صفر باشد، بی‌درنگ پاک می‌شود (برای تست). بازی‌ها این تابع را با
 * `void` صدا می‌زنند؛ یعنی منتظر ماندن برای پاک‌سازی، نوبت بعدی را عقب نمی‌اندازد.
 */
export async function purgeGameMessages(
  telegram: any,
  key: string,
  delayMs: number = GAME_RESULT_PURGE_DELAY_MS
): Promise<number> {
  const ledger = ledgers.get(key);
  if (!ledger) return 0;
  ledgers.delete(key);

  const client = telegram ?? ledger.telegram;
  if (!client) return 0;

  if (delayMs > 0) await sleep(delayMs);
  return deleteLedgerMessages(client, ledger);
}

async function deleteLedgerMessages(client: any, ledger: GameLedger): Promise<number> {
  let removed = 0;
  for (const messageId of ledger.messages) {
    try {
      await client.deleteMessage(ledger.chatId, messageId);
      removed++;
    } catch {
      // بدون حق حذف: لااقل دکمه‌ها را بردار
      try {
        await client.editMessageReplyMarkup(ledger.chatId, messageId, undefined);
      } catch {}
    }
  }
  return removed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// دفترهای بی‌استفاده: بازیکنانی که گروه را وسط بازی رها می‌کنند نباید
// تختهٔ مرده‌شان تا ابد در گروه بماند.
setInterval(() => {
  const cutoff = Date.now() - GAME_ABANDONED_AFTER_MS;
  for (const [key, ledger] of ledgers.entries()) {
    if (ledger.touchedAt >= cutoff) continue;
    ledgers.delete(key);
    if (ledger.telegram) void deleteLedgerMessages(ledger.telegram, ledger);
  }
}, 600_000);

// ─── Channel Join Check for Games ────────────
export async function checkGameChannelJoin(ctx: Context): Promise<boolean> {
  const forceJoin = await getSettingBool('force_join_channels');
  if (!forceJoin) return true;

  const botId = getBotId(ctx);
  const user = await findUserByCtx(ctx);
  if (!user) return false;

  const channels = await prisma.channel.findMany({
    where: { botId, isRequired: true, isActive: true },
    orderBy: { joinOrder: 'asc' },
  });

  if (channels.length === 0) return true;

  const notJoined: { username: string; title: string }[] = [];

  for (const channel of channels) {
    try {
      const member = await ctx.telegram.getChatMember(
        channel.channelId.toString(),
        ctx.from!.id
      );
      if (!['creator', 'administrator', 'member'].includes(member.status)) {
        notJoined.push({
          username: channel.channelUsername,
          title: channel.title || channel.channelUsername,
        });
      }
    } catch {
      notJoined.push({
        username: channel.channelUsername,
        title: channel.title || channel.channelUsername,
      });
    }
  }

  if (notJoined.length > 0) {
    const channelLinks = notJoined.map((ch) => `📢 ${ch.title}`).join('\n');
    const buttons: any[] = notJoined.map((ch) => [
      Markup.button.url(
        `📢 عضویت در ${ch.title}`,
        `https://t.me/${ch.username.replace(/^@/, '')}`
      ),
    ]);
    buttons.push([Markup.button.callback('✅ بررسی مجدد', 'game_check_membership')]);

    await ctx.reply(
      `⚠️ برای شرکت در بازی‌ها، ابتدا عضو کانال‌های زیر شوید:\n\n${channelLinks}`,
      Markup.inlineKeyboard(buttons)
    );
    return false;
  }

  return true;
}
