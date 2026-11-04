// ─── پخش خودکار موزیک در زمان تعیین‌شده ─────────────────────────
// خواستهٔ کارفرما: در پنل (بخش موزیک) برای هر ربات یک «زمان» تعریف شود و در آن
// زمان، ربات خودش یک آهنگ **تصادفی** از کتابخانهٔ مشترک را **به‌شکل ویس** — با
// همان کپشن نسخهٔ ۱٫۹٫۰ (خط اول نام آهنگ، خط دوم آیدی ربات) — در گروه‌هایی که
// مدیریت انتخاب کرده بفرستد. متن اضافه، کارت، و دکمه‌ای فرستاده نمی‌شود.
//
// چرا cron دستی و نه node-cron: زمان بعدی باید در دیتابیس ذخیره و در پنل دیده
// شود ( «بعدی: …» ) و بعد از ری‌استارت ربات هم گم نشود. یک تایمر هر ۳۰ ثانیه
// سطرهای رسیده را اجرا می‌کند و nextRunAt بعدی را از نو می‌شمارد.
//
// ساعت‌ها محلی‌اند (timezone سطر، پیش‌فرض Asia/Tehran) و همیشه به UTC تبدیل
// می‌شوند؛ پس مقدار ذخیره‌شده به منطقهٔ زمانی کانتینر وابسته نیست.

import { prisma } from './prisma.js';
import { getSettingBool } from './settings.js';
import { isFeatureAllowed } from './bot-access.js';
import { getBotInstance } from '../bot/index.js';
import { pickRandomTrack } from './music-library.js';
import { recentTracksOf, sendTrackAsVoice } from '../bot/music.js';

export const SCHEDULE_KINDS = ['daily', 'interval', 'once'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export const DEFAULT_TIMEZONE = 'Asia/Tehran';
/** فاصلهٔ دو اجرا — کوتاه‌تر از این، یک گروه دو ویس پشت‌سرهم می‌گیرد */
export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
export const MAX_TIMES_PER_SCHEDULE = 8;
export const MAX_GROUPS_PER_SCHEDULE = 50;
export const MAX_SCHEDULES = 50;
/** حداکثر تعداد گروه‌هایی که در یک اجرا پشت‌سرهم پیام می‌گیرند */
const GROUP_PAUSE_MS = 250;
const RATE_CHUNK = 15;
const RATE_PAUSE_MS = 1000;
/** تایمر بررسی سطرهای رسیده */
const TICK_MS = 30_000;

/** روزهای هفته همان عدد Date.getDay() هستند (۰=یکشنبه … ۶=شنبه) */
export const WEEKDAY_RANGE = [0, 1, 2, 3, 4, 5, 6];

export interface ScheduleShape {
  kind: string;
  times?: string[] | null;
  days?: number[] | null;
  intervalMinutes?: number | null;
  onceAt?: Date | string | null;
  timezone?: string | null;
  lastRunAt?: Date | string | null;
}

const CLOCK_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** «HH:MM»های معتبر، یکدست، بدون تکرار و مرتب — ورودی نامعتبر حذف می‌شود */
export function normalizeClockTimes(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const raw of values) {
    const text = String(raw ?? '').trim();
    const match = CLOCK_RE.exec(text);
    if (!match) continue;
    const clock = `${String(match[1]).padStart(2, '0')}:${match[2]}`;
    if (!out.includes(clock)) out.push(clock);
  }
  return out.sort().slice(0, MAX_TIMES_PER_SCHEDULE);
}

/** روزهای هفتهٔ معتبر (خالی = هر روز) */
export function normalizeDays(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  const out: number[] = [];
  for (const raw of values) {
    const day = Number(raw);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    if (!out.includes(day)) out.push(day);
  }
  return out.sort();
}

/** منطقهٔ زمانی معتبر؟ (Intl همان‌جا می‌شکند اگر غلط باشد) */
export function isKnownTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function safeTimezone(tz: unknown): string {
  const text = String(tz ?? '').trim();
  return isKnownTimezone(text) ? text : DEFAULT_TIMEZONE;
}

/** فاصلهٔ منطقهٔ زمانی از UTC (مिलی‌ثانیه، مثبت = شرق گرینویچ) */
export function timezoneOffsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const valueOf = (type: string) =>
    parseInt(parts.find((part) => part.type === type)?.value || '0', 10);
  const asIfUtc = Date.UTC(
    valueOf('year'),
    valueOf('month') - 1,
    valueOf('day'),
    valueOf('hour') % 24,
    valueOf('minute'),
    valueOf('second')
  );
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** تاریخ و روزِ هفتهٔ محلیِ یک لحظه، در آن منطقهٔ زمانی */
export function localDateOf(tz: string, at: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const valueOf = (type: string) =>
    parseInt(parts.find((part) => part.type === type)?.value || '1', 10);
  return { year: valueOf('year'), month: valueOf('month'), day: valueOf('day') };
}

/** روزِ هفته (۰=یکشنبه) از یک تاریخ محلیِ خالص */
function weekdayOf(year: number, month: number, day: number): number {
  const epochDays = Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
  return (((epochDays + 4) % 7) + 7) % 7;
}

/**
 * «HH:MM» محلی در آن روز → لحظهٔ UTC.
 * دو بار اصلاح می‌شود تا اگر منطقهٔ زمانی تغییر ساعت داشت (DST) باز هم دقیق بماند.
 */
function localMomentToUtc(tz: string, year: number, month: number, day: number, clock: string): number {
  const [hour, minute] = clock.split(':').map((part) => parseInt(part, 10));
  const naive = Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0, 0);
  const first = naive - timezoneOffsetMs(tz, new Date(naive));
  return naive - timezoneOffsetMs(tz, new Date(first));
}

/**
 * نزدیک‌ترین اجرای آینده بعد از `from` (نه خودِ `from`).
 * null یعنی زمان بعدی‌ای نیست (یک‌بارمصرف گذشته، یا تنظیم کامل نیست).
 */
export function computeNextRunAt(schedule: ScheduleShape, from: Date = new Date()): Date | null {
  const tz = safeTimezone(schedule.timezone);
  const nowMs = from.getTime();

  if (schedule.kind === 'once') {
    const at = schedule.onceAt ? new Date(schedule.onceAt as any) : null;
    if (!at || Number.isNaN(at.getTime())) return null;
    return at.getTime() > nowMs ? at : null;
  }

  if (schedule.kind === 'interval') {
    const minutes = Number(schedule.intervalMinutes || 0);
    if (!Number.isFinite(minutes) || minutes < 1) return null;
    const last = schedule.lastRunAt ? new Date(schedule.lastRunAt).getTime() : 0;
    const candidate = last ? last + minutes * 60_000 : 0;
    // اگر ربات خاموش بوده و فاصله‌ها رد شده‌اند، فقط یک اجرا جبران می‌شود:
    // مبدأ شمارش «اکنون» است، نه قدیمی‌ترین ساعت از دست رفته.
    return new Date(candidate > nowMs ? candidate : nowMs + minutes * 60_000);
  }

  // نوع ناشناخته (سطرِ دست‌کاری‌شده در دیتابیس) هرگز ارسال نمی‌کند؛ تایکر با
  // توضیح فارسی غیرفعالش می‌کند به‌جای اینکه بی‌مصرف یک رفتار پیش‌فرض بگیرد.
  if (!(SCHEDULE_KINDS as readonly string[]).includes(schedule.kind)) return null;

  const times = normalizeClockTimes(schedule.times);
  if (times.length === 0) return null;
  const days = normalizeDays(schedule.days);

  const start = localDateOf(tz, from);
  // هشت روز کافی است: هر الگوی هفتگی حداکثر هفت روز بعد تکرار می‌شود
  for (let offset = 0; offset <= 8; offset++) {
    const shifted = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth() + 1;
    const day = shifted.getUTCDate();
    if (days.length > 0 && !days.includes(weekdayOf(year, month, day))) continue;

    for (const clock of times) {
      const ms = localMomentToUtc(tz, year, month, day, clock);
      if (ms > nowMs) return new Date(ms);
    }
  }
  return null;
}

/** چند اجرای بعدی (برای پیش‌نمایش در پنل و برای تست) */
export function upcomingRuns(schedule: ScheduleShape, from: Date, count = 3): Date[] {
  const out: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const next = computeNextRunAt(schedule, cursor);
    if (!next) break;
    out.push(next);
    cursor = new Date(next.getTime() + 1000);
  }
  return out;
}

export interface RunReport {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  trackTitle: string | null;
  errors: string[];
  /** پیامی که در lastResult سطر می‌ماند (فارسی، کوتاه) */
  summary: string;
}

function describeFailure(reason: string): string {
  return reason.length > 90 ? `${reason.slice(0, 90)}…` : reason;
}

/** سطر کامل زمان‌بندی، همان‌طور که Prisma بیرون می‌دهد */
export interface ScheduleRow {
  id: number;
  name: string | null;
  botId: number;
  chatIds: string[];
  kind: string;
  times: string[];
  days: number[];
  intervalMinutes: number | null;
  onceAt: Date | null;
  timezone: string;
  lastRunAt?: Date | null;
}

/**
 * یک زمان‌بندی را همین حالا اجرا می‌کند: آهنگ تصادفی انتخاب و در گروه‌های
 * انتخابی فرستاده می‌شود. چیزی در دیتابیس زمان‌بندی تغییر نمی‌دهد — مسئول
 * ثبت nextRunAt/lastRunAt فراخوان است.
 * telegram را می‌توان داد (تست); اگر داده نشد، نمونهٔ زندهٔ همان ربات برداشته
 * می‌شود تا مسیر واقعیِ ربات دقیقاً همان مسیری باشد که کاربر استفاده می‌کند.
 */
export async function deliverSchedule(
  schedule: {
    id: number;
    name: string | null;
    botId: number;
    chatIds: string[];
    timezone: string;
  },
  injectedTelegram?: any
): Promise<RunReport> {
  const report: RunReport = {
    total: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    trackTitle: null,
    errors: [],
    summary: '',
  };

  const pushError = (text: string) => {
    if (report.errors.length < 6) report.errors.push(text);
  };

  if (!(await getSettingBool('music_enabled'))) {
    report.summary = '🔇 بخش موزیک در تنظیمات سراسری خاموش است';
    return report;
  }
  if (!(await isFeatureAllowed(schedule.botId, 'music'))) {
    report.summary = '🔇 دسترسی موزیک این ربات در پنل بسته شده است';
    return report;
  }

  const wanted = schedule.chatIds
    .map((id) => String(id ?? '').trim())
    .filter((id) => /^-?\d+$/.test(id));
  if (wanted.length === 0) {
    report.summary = '⚠️ گروهی برای این زمان‌بندی انتخاب نشده است';
    return report;
  }

  const groups = await prisma.groupChat.findMany({
    where: { botId: schedule.botId, chatId: { in: wanted.map((id) => BigInt(id)) } },
    select: { id: true, chatId: true, title: true, isJoined: true },
  });
  const found = new Set(groups.map((group) => group.chatId.toString()));
  for (const id of wanted) {
    if (!found.has(id)) {
      report.skipped++;
      pushError(`گروه ${id}: در فهرست گروه‌های این ربات نیست`);
    }
  }

  const targets = groups.filter((group) => group.isJoined);
  for (const group of groups) {
    if (!group.isJoined) {
      report.skipped++;
      pushError(`«${group.title ?? group.chatId}» ربات دیگر در آن نیست`);
    }
  }
  report.total = targets.length;
  if (targets.length === 0) {
    report.summary =
      report.errors.length > 0
        ? `⚠️ پیامی ارسال نشد — ${report.errors[0]}`
        : '⚠️ گروه‌های این زمان‌بندی قابل پخش نبودند';
    return report;
  }

  const telegram = injectedTelegram ?? getBotInstance(schedule.botId)?.telegram;
  if (!telegram) {
    report.summary = '❌ ربات در حال اجرا نیست؛ در پنل فعالش کنید';
    return report;
  }

  // آهنگ‌های پخش‌اخیرِ همهٔ گروه‌ها کنار می‌روند تا گروهی همان دیروز را نشنود
  const recent = new Set<number>();
  for (const group of targets) {
    for (const id of recentTracksOf(schedule.botId, Number(group.chatId))) recent.add(id);
  }

  const track = await pickRandomTrack([...recent]);
  if (!track) {
    report.summary = '🎵 کتابخانهٔ موزیک خالی است؛ از پنل آهنگ آپلود کنید';
    return report;
  }
  report.trackTitle = track.title;

  const requestName = `⏰ ${schedule.name || 'پخش خودکار'}`.slice(0, 64);
  let processed = 0;

  for (const group of targets) {
    const chatId = Number(group.chatId);
    let result = await sendTrackAsVoice({
      telegram,
      botId: schedule.botId,
      chatId,
      track,
      requestName,
    });

    // همان آهنگ در این گروه پخش نشد (فایل نیست/فرمت نامعتبر) → یک آهنگ دیگر
    if (!result.ok) {
      const backup = await pickRandomTrack([track.id, ...recent, ...recentTracksOf(schedule.botId, chatId)]);
      if (backup && backup.id !== track.id) {
        result = await sendTrackAsVoice({
          telegram,
          botId: schedule.botId,
          chatId,
          track: backup,
          requestName,
        });
        if (result.ok) report.trackTitle = `${track.title} → ${backup.title}`;
      }
    }

    if (result.ok) {
      report.sent++;
    } else {
      report.failed++;
      pushError(`«${group.title ?? group.chatId}»: ${describeFailure(result.reason || 'خطای ناشناخته')}`);
    }

    processed++;
    // محدودیت نرخ تلگرام (پیام‌های گروهی)
    if (processed % RATE_CHUNK === 0) await pause(RATE_PAUSE_MS);
    else await pause(GROUP_PAUSE_MS);
  }

  report.summary =
    report.sent > 0
      ? `✅ ${report.sent} گروه «${report.trackTitle}» را گرفت` +
        (report.failed ? ` · ${report.failed} خطا` : '') +
        (report.skipped ? ` · ${report.skipped} رد شد` : '')
      : `❌ ارسال نشد: ${report.errors[0] || 'دلیل نامشخص'}`;
  return report;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** زمان‌بندیِ ذخیره‌شده را بیرون می‌کشد و سطر را به‌روز می‌کند */
async function fireSchedule(row: ScheduleRow, injectedTelegram?: any): Promise<RunReport> {
  const report = await deliverSchedule(row, injectedTelegram);
  const finishedAt = new Date();

  if (row.kind === 'once') {
    // یک‌بارمصرف انجام شد → خاموش، تا دوباره در هر ری‌استارت ارسال نشود
    await prisma.musicSchedule
      .update({
        where: { id: row.id },
        data: {
          isActive: false,
          lastRunAt: finishedAt,
          nextRunAt: null,
          runCount: { increment: 1 },
          lastResult: report.summary.slice(0, 400),
        },
      })
      .catch(() => undefined);
    return report;
  }

  const next = computeNextRunAt({ ...row, lastRunAt: finishedAt }, finishedAt);

  await prisma.musicSchedule
    .update({
      where: { id: row.id },
      data: {
        lastRunAt: finishedAt,
        nextRunAt: next,
        runCount: { increment: 1 },
        lastResult: report.summary.slice(0, 400),
      },
    })
    .catch(() => undefined);

  return report;
}

/**
 * اجرای دستی از پنل (دکمهٔ «همین حالا امتحان کن»): ارسال می‌کند ولی
 * nextRunAt را جابه‌جا نمی‌کند، چون ساعت بعدی برنامه عوض نمی‌شود.
 */
export async function runScheduleNow(id: number, injectedTelegram?: any): Promise<RunReport> {
  const row = await prisma.musicSchedule.findUnique({ where: { id } });
  if (!row) throw new Error('not-found');
  return deliverSchedule(row, injectedTelegram);
}

const inFlight = new Set<number>();

/**
 * یک بار بررسی: سطرهای رسیده را اجرا می‌کند.
 * برگمی‌گرداند تعداد زمان‌بندی‌هایی که اجرا شدند.
 */
export async function tickMusicSchedules(now: Date = new Date()): Promise<number> {
  if (!(await getSettingBool('music_schedule_enabled'))) return 0;

  const due = await prisma.musicSchedule.findMany({
    where: { isActive: true, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }] },
    orderBy: { nextRunAt: 'asc' },
    take: 10,
  });

  let fired = 0;
  for (const row of due) {
    if (inFlight.has(row.id)) continue;
    inFlight.add(row.id);
    try {
      // نوع ناشناخته (سطر دست‌کاری‌شده) ارسال نمی‌کند؛ خاموش می‌شود تا گیر نکند
      if (!(SCHEDULE_KINDS as readonly string[]).includes(row.kind)) {
        await prisma.musicSchedule
          .update({
            where: { id: row.id },
            data: {
              isActive: false,
              nextRunAt: null,
              lastResult: '⏰ نوع زمان‌بندی این سطر شناخته نیست؛ غیرفعال شد. دوباره تنظیمش کنید.',
            },
          })
          .catch(() => undefined);
        continue;
      }

      if (!row.nextRunAt) {
        // سطر بی‌ساعتِ بعدی (مثلاً ساخت ناقص یا یک‌بارمصرفِ گذشته) → از نو شمارش
        const next = computeNextRunAt(row, now);
        if (!next) {
          await prisma.musicSchedule
            .update({
              where: { id: row.id },
              data: {
                isActive: false,
                lastResult: '⏰ زمان بعدی پیدا نشد؛ زمان‌بندی غیرفعال شد. دوباره تنظیمش کنید.',
              },
            })
            .catch(() => undefined);
        } else {
          await prisma.musicSchedule
            .update({ where: { id: row.id }, data: { nextRunAt: next } })
            .catch(() => undefined);
        }
        continue;
      }

      // اجراهای خیلی قدیمی (ربات رفته بود خاموش) فقط یک بار جبران می‌شوند
      await fireSchedule(row);
      fired++;
    } catch (error: any) {
      console.error('Music schedule tick error:', error?.message || error);
      // سطر نباید در هر ۳۰ ثانیه دوباره گیر بکند
      const next = computeNextRunAt({ ...row, lastRunAt: now }, now);
      await prisma.musicSchedule
        .update({
          where: { id: row.id },
          data: {
            nextRunAt: next,
            lastRunAt: now,
            lastResult: `❌ خطا در اجرای زمان‌بندی: ${String(error?.message || error).slice(0, 120)}`,
          },
        })
        .catch(() => undefined);
    } finally {
      inFlight.delete(row.id);
    }
  }
  return fired;
}

let ticker: NodeJS.Timeout | null = null;

/** شروع تایمر زمان‌بندی (فقط یک بار) + یک بررسی فوری برای اجرای جا‌مانده */
export function startMusicScheduler(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    void tickMusicSchedules().catch((error) =>
      console.error('Music scheduler error:', error?.message || error)
    );
  }, TICK_MS);
  ticker.unref?.();
  void tickMusicSchedules().catch(() => undefined);
  console.log(`Music scheduler started (every ${TICK_MS / 1000}s)`);
}

export function stopMusicScheduler(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

/** فقط برای تست: آیا تایمر روشن است */
export function musicSchedulerRunning(): boolean {
  return ticker !== null;
}
