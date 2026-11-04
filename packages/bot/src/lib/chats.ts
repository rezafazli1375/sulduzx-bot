import type { Context } from 'telegraf';
import { prisma } from './prisma.js';

/**
 * ثبت گروه‌هایی که ربات در آن‌ها حضور دارد.
 *
 * ربات تلگرام با Bot API نمی‌تواند فهرست چت‌های خودش را بگیره، پس تنها راه،
 * گوش دادن به رویدادهاست: هر پیام/دکمه در گروه، و رویداد my_chat_member
 * (وقتی ربات را اضافه یا از گروه بیرون می‌کنند). این جدول هم «ارسال پیام به
 * گروه‌ها» را ممکن می‌کند و هم آمار «چند گروه» را.
 */

/** هر چت حداکثر یک‌بار در این بازه در دیتابیس نوشته می‌شود (تلفیقی با ترافیک گروه) */
const TOUCH_TTL_MS = 10 * 60 * 1000;
const lastTouch = new Map<number, number>();

function isGroup(ctx: Context): boolean {
  const type = ctx.chat?.type;
  return type === 'group' || type === 'supergroup';
}

/**
 * یک گروه را دیده‌بان می‌کند: عنوان، نوع و زمان آخرین فعالیت.
 * بی‌صدا کار می‌کند؛ خطای دیتابیس هرگز جریان پیام را نمی‌شکند.
 */
export async function touchGroup(ctx: Context): Promise<void> {
  if (!isGroup(ctx)) return;
  const chat = ctx.chat;
  if (!chat) return;

  const now = Date.now();
  const seen = lastTouch.get(chat.id);
  if (seen && now - seen < TOUCH_TTL_MS) return;
  lastTouch.set(chat.id, now);

  const botId = (ctx as Context & { botId?: number }).botId;
  if (!botId) return;

  const title = (chat as any).title as string | undefined;
  const username = (chat as any).username as string | undefined;

  try {
    await prisma.groupChat.upsert({
      where: { botId_chatId: { botId, chatId: BigInt(chat.id) } },
      create: {
        botId,
        chatId: BigInt(chat.id),
        title: title ?? null,
        username: username ?? null,
        chatType: chat.type,
        isJoined: true,
        lastSeenAt: new Date(),
      },
      update: {
        ...(title ? { title } : {}),
        ...(username ? { username } : {}),
        chatType: chat.type,
        isJoined: true,
        leftAt: null,
        lastSeenAt: new Date(),
      },
    });
  } catch (error: any) {
    lastTouch.delete(chat.id);
    console.error('touchGroup error:', error?.message || String(error));
  }
}

/**
 * رویداد my_chat_member: حضور یا خروج خود ربات.
 * status = left/kicked یعنی ربات دیگر در گروه نیست.
 */
export async function syncMyChatMember(ctx: Context): Promise<void> {
  if (ctx.updateType !== 'my_chat_member') return;
  const chat = ctx.chat;
  const botId = (ctx as Context & { botId?: number }).botId;
  if (!chat || !botId) return;
  if (chat.type !== 'group' && chat.type !== 'supergroup') return;

  const status = (ctx.update as any).my_chat_member?.new_chat_member?.status as string;
  const gone = status === 'left' || status === 'kicked';
  const admin = status === 'administrator' || status === 'creator';

  lastTouch.set(chat.id, Date.now());

  try {
    await prisma.groupChat.upsert({
      where: { botId_chatId: { botId, chatId: BigInt(chat.id) } },
      create: {
        botId,
        chatId: BigInt(chat.id),
        title: (chat as any).title ?? null,
        username: (chat as any).username ?? null,
        chatType: chat.type,
        isJoined: !gone,
        botIsAdmin: admin,
        leftAt: gone ? new Date() : null,
        lastSeenAt: new Date(),
      },
      update: {
        ...( (chat as any).title ? { title: (chat as any).title } : {}),
        chatType: chat.type,
        isJoined: !gone,
        botIsAdmin: admin,
        leftAt: gone ? new Date() : null,
        ...(gone ? {} : { lastSeenAt: new Date() }),
      },
    });
    console.log(`Group ${chat.id} → ${gone ? 'LEFT' : admin ? 'ADMIN' : 'MEMBER'} (bot ${botId})`);
  } catch (error: any) {
    console.error('syncMyChatMember error:', error?.message || String(error));
  }
}

/**
 * شمارش اعضای گروه (فقط وقتی از پنل لازم است؛ هزینهٔ API دارد).
 * Bot API این تعداد را فقط برای ربات‌های عضو گروه می‌دهد.
 */
export async function refreshMemberCount(
  ctx: Context,
  chatIds: bigint[]
): Promise<void> {
  const telegram: any = ctx.telegram;
  const call = telegram?.getChatMemberCount || telegram?.getChatMembersCount;
  if (typeof call !== 'function') return;
  for (const chatId of chatIds) {
    try {
      const count = await call.call(telegram, chatId.toString());
      if (typeof count !== 'number') continue;
      await prisma.groupChat.updateMany({
        where: { chatId, botId: (ctx as Context & { botId?: number }).botId ?? 0 },
        data: { memberCount: count },
      });
    } catch {
      // گروه بسته/دسترسی غیرفعال — دست نمی‌زنیم
    }
  }
}
