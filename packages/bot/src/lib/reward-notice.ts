import { prisma } from './prisma.js';
import { getSettingBool } from './settings.js';
import { cheapestRewardCost, sendRewardNotice } from '../bot/points-rewards.js';
import { getBotInstance } from '../bot/index.js';

/**
 * اطلاع‌رسانی «می‌توانید پاداش بگیرید».
 *
 * به‌جای اینکه داخل هر بازی/چک‌این/رفرال یک فراخوانی اضافه شود (۹ نقطهٔ مختلف و
 * هرکدام با شکل خودش)، یک جاروی دوره‌ای کسانیکه امتیازشان به حد نصاب رسیده را
 * پیدا می‌کند. این‌طور منبع امتیاز فرقی نمی‌کند — حتی تنظیم دستی امتیاز از پنل
 * هم اطلاع می‌دهد — و کد بازی‌ها دست‌نخورده می‌ماند.
 *
 * سقف هر دور BATCH کاربر است تا یک استارت دوباره سیل پیام نسازد؛ خودِ
 * اطلاع‌رسانی هم برای هر پاداش حداکثر یک بار در سه روز فرستاده می‌شود.
 */

const TICK_MS = 15 * 60 * 1000;
const BATCH = 50;

export interface NoticeReport {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
}

/** یک دور جارو؛ telegram را می‌توان برای تست تزریق کرد */
export async function tickRewardNotices(
  injectedTelegram?: (botId: number) => any
): Promise<NoticeReport> {
  const report: NoticeReport = { scanned: 0, sent: 0, skipped: 0, failed: 0 };

  if (!(await getSettingBool('reward_points_enabled'))) return report;
  if (!(await getSettingBool('reward_notice_enabled'))) return report;

  const minCost = await cheapestRewardCost();
  if (minCost === null) return report;

  // هرکس کمتر از ۱۲ ساعت پیش اطلاع گرفته در این دور کنار می‌رود، تا چند کاربر
  // همیشه‌مجازی صف را برای بقیه نبندد. (null یعنی هرگز اطلاع داده نشده.)
  const candidates = await prisma.user.findMany({
    where: {
      points: { gte: minCost },
      isBlocked: false,
      configBlocked: false,
      OR: [{ rewardNoticeAt: null }, { rewardNoticeAt: { lt: new Date(Date.now() - 12 * 60 * 60 * 1000) } }],
    },
    orderBy: [{ points: 'desc' }, { id: 'asc' }],
    take: BATCH,
    select: { id: true, botId: true },
  });

  for (const candidate of candidates) {
    report.scanned++;
    const telegram =
      typeof injectedTelegram === 'function'
        ? injectedTelegram(candidate.botId)
        : getBotInstance(candidate.botId)?.telegram;
    if (!telegram) {
      report.skipped++;
      continue;
    }
    try {
      const result = await sendRewardNotice(telegram, candidate.id);
      report[result === 'sent' ? 'sent' : result === 'failed' ? 'failed' : 'skipped']++;
    } catch (error: any) {
      report.failed++;
      console.error(`Reward notice error (user ${candidate.id}):`, error?.message || error);
    }
  }

  return report;
}

let ticker: NodeJS.Timeout | null = null;

/** شروع جاروی پاداش‌ها (فقط یک بار). در استارت بلافاصله اجرا نمی‌شود تا ربات‌ها بالا بیایند. */
export function startRewardNoticeSweeper(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    void tickRewardNotices().catch((error) =>
      console.error('Reward notice sweeper error:', error?.message || error)
    );
  }, TICK_MS);
  ticker.unref?.();
  console.log(`Reward notice sweeper started (every ${TICK_MS / 1000}s)`);
}

export function stopRewardNoticeSweeper(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

/** فقط برای تست */
export function rewardNoticeSweeperRunning(): boolean {
  return ticker !== null;
}
