import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { getSettingNumber } from '../../lib/settings.js';
import { getBotInstance } from '../../bot/index.js';
import { playTrackInChat, reconcileMusicPlays } from '../../bot/music.js';
import {
  MAX_GROUPS_PER_SCHEDULE,
  MAX_INTERVAL_MINUTES,
  MAX_SCHEDULES,
  MAX_TIMES_PER_SCHEDULE,
  MIN_INTERVAL_MINUTES,
  SCHEDULE_KINDS,
  computeNextRunAt,
  isKnownTimezone,
  normalizeClockTimes,
  normalizeDays,
  runScheduleNow,
  safeTimezone,
  timezoneOffsetMs,
  upcomingRuns,
} from '../../lib/music-schedule.js';
import {
  MUSIC_DEFAULT_MAX_MB,
  audioExtension,
  audioFileExists,
  cleanMusicTitle,
  isAudioFileName,
  removeAudioFile,
  removeVoiceCache,
  saveAudioFile,
} from '../../lib/music-library.js';

const router = Router();

// ─── کتابخانهٔ مشترک ─────────────────────────
// آهنگ‌ها به هیچ رباتی نمی‌چسبند: هر ربات فعالی از همان فهرست پخش می‌کند.
// لیست، آپلود ویرایش و حذف همه بدون botId کار می‌کنند و فقط «پخش در گروه» به
// رباتِ آن گروه نیاز دارد.

/** حالت «در حال پخش» بیشتر از این مدت معتبر نیست (ربات ری‌استارت شده باشد) */
const NOW_PLAYING_WINDOW_MS = 3 * 60 * 60_000;

async function maxUploadBytes(): Promise<number> {
  const configured = await getSettingNumber('music_max_mb');
  const mb = configured > 0 ? configured : MUSIC_DEFAULT_MAX_MB;
  // سقف سخت ۲۰ مگابایت: بدنهٔ base64 از محدودیت ۴۵ مگابایت بدنهٔ API رد نشود
  return Math.min(Math.max(1, mb), 20) * 1024 * 1024;
}

/** تبدیل خروجی Prisma به چیزی که مرورگر safely می‌خواند (BigInt → رشته) */
function serializeTrack(track: any) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    fileSize: track.fileSize,
    mimeType: track.mimeType,
    playCount: track.playCount,
    isActive: track.isActive,
    source: track.source,
    hasLocalFile: audioFileExists(track.filePath),
    createdAt: track.createdAt,
  };
}

// ─── فهرست آهنگ‌ها ────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const where: any = {};

    const search = String(req.query?.search || '').trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { artist: { contains: search, mode: 'insensitive' } },
      ];
    }

    const tracks = await prisma.musicTrack.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    res.json({ total: tracks.length, tracks: tracks.map(serializeTrack) });
  } catch (error) {
    console.error('Music list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── آمار موزیک + آنچه همین حالا پخش می‌شود ──
router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const since = new Date(Date.now() - NOW_PLAYING_WINDOW_MS);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalPlays, playsToday, nowPlaying, totalTracks, activeTracks] = await Promise.all([
      prisma.musicPlay.count(),
      prisma.musicPlay.count({ where: { startedAt: { gte: today } } }),
      prisma.musicPlay.findMany({
        where: { status: 'PLAYING', startedAt: { gte: since } },
        orderBy: { startedAt: 'desc' },
        take: 50,
        include: {
          track: { select: { title: true, artist: true } },
          group: { select: { title: true, username: true, memberCount: true } },
        },
      }),
      prisma.musicTrack.count(),
      prisma.musicTrack.count({ where: { isActive: true } }),
    ]);

    // MusicPlay فقط به گروه وابسته است، نه به ربات؛ نام ربات جدا خوانده می‌شود
    const bots = await prisma.bot.findMany({ select: { id: true, name: true } });
    const botNameOf = new Map(bots.map((bot) => [bot.id, bot.name]));

    res.json({
      totalPlays,
      playsToday,
      totalTracks,
      activeTracks,
      nowPlayingCount: nowPlaying.length,
      nowPlaying: nowPlaying.map((play) => ({
        id: play.id,
        botId: play.botId,
        botName: botNameOf.get(play.botId) || null,
        chatId: play.chatId.toString(),
        groupTitle: play.group?.title || 'گروه ناشناس',
        groupUsername: play.group?.username || null,
        memberCount: play.group?.memberCount ?? null,
        title: play.track?.title || '—',
        artist: play.track?.artist || null,
        requestName: play.requestName,
        startedAt: play.startedAt,
      })),
    });
  } catch (error) {
    console.error('Music stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── بستن رکوردهای مانده از پخش‌های قبلی ─────
router.post('/reconcile', async (_req: AuthRequest, res: Response) => {
  try {
    const closed = await reconcileMusicPlays();
    res.json({ success: true, closed });
  } catch (error) {
    console.error('Music reconcile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── گروه‌هایی که می‌توان در آن‌ها پخش کرد ────
// هر گروه با ربات خودش فهرست می‌شود؛ پخش از همان ربات انجام می‌شود.
router.get('/groups', async (req: AuthRequest, res: Response) => {
  try {
    const botIdRaw = req.query?.botId;
    const botId =
      botIdRaw !== undefined && botIdRaw !== '' ? parseInt(String(botIdRaw), 10) : undefined;

    const where: any = { isJoined: true, chatType: { notIn: ['channel'] } };
    if (botId && Number.isInteger(botId)) where.botId = botId;

    const groups = await prisma.groupChat.findMany({
      where,
      orderBy: [{ lastSeenAt: 'desc' }],
      take: 500,
      select: {
        id: true,
        botId: true,
        chatId: true,
        title: true,
        username: true,
        chatType: true,
        memberCount: true,
        lastSeenAt: true,
      },
    });

    const bots = await prisma.bot.findMany({ select: { id: true, name: true } });
    const nameOf = new Map(bots.map((bot) => [bot.id, bot.name]));

    res.json({
      total: groups.length,
      groups: groups.map((group) => ({
        ...group,
        chatId: group.chatId.toString(),
        botName: nameOf.get(group.botId) || null,
      })),
    });
  } catch (error) {
    console.error('Music groups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── پخش خودکار در زمان تعیین‌شده ────────────
// هر سطر = یک ربات + یک برنامهٔ زمانی + فهرست گروه‌های انتخابی. در زمانش، یک
// آهنگ تصادفی از کتابخانهٔ مشترک به‌شکل ویس در همان گروه‌ها فرستاده می‌شود
// (مسیر دقیق /play: کپشن «نام آهنگ» و «آیدی ربات»، بدون متن و دکمهٔ اضافه).
// ساعت‌ها محلیِ منطقهٔ زمانیِ سطر هستند و nextRunAt همیشه UTC ذخیره می‌شود.

const WEEKDAY_LABELS: Record<number, string> = {
  6: 'شنبه',
  0: 'یکشنبه',
  1: 'دوشنبه',
  2: 'سه‌شنبه',
  3: 'چهارشنبه',
  4: 'پنج‌شنبه',
  5: 'جمعه',
};

/** ترتیب نمایش روزها در پنل: هفتهٔ ایرانی از شنبه */
const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

const WALL_CLOCK_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;
const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/;

/**
 * «HH:MM» را با منطقهٔ زمانی می‌خواند.
 * مقدار بی‌ناو (datetime-local مرورگر) ساعتِ **محلیِ آن منطقه** است، نه ساعتِ
 * مرورگر مدیر؛ مقدار با Z یا offset همان‌طور که هست گرفته می‌شود.
 */
function parseWhen(value: unknown, tz: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (OFFSET_RE.test(text)) {
    const withOffset = new Date(text);
    return Number.isNaN(withOffset.getTime()) ? null : withOffset;
  }
  const parts = WALL_CLOCK_RE.exec(text);
  if (parts) {
    const naive = Date.UTC(
      Number(text.slice(0, 4)),
      Number(text.slice(5, 7)) - 1,
      Number(text.slice(8, 10)),
      Number(text.slice(11, 13) || '0'),
      Number(text.slice(14, 16) || '0'),
      Number(text.slice(17, 19) || '0')
    );
    return new Date(naive - timezoneOffsetMs(tz, new Date(naive)));
  }
  const loose = new Date(text);
  return Number.isNaN(loose.getTime()) ? null : loose;
}

/** برچسب فارسیِ ساعتِ محلی (برای «اجرای بعدی» در پنل) */
function wallClockLabel(tz: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: tz,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  } catch {
    return at.toISOString();
  }
}

function intervalLabel(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours % 24 === 0 ? `هر ${hours / 24} روز` : `هر ${hours} ساعت`;
  }
  return `هر ${minutes} دقیقه`;
}

function scheduleLabel(row: { kind: string; times: string[]; days: number[]; intervalMinutes: number | null }): string {
  if (row.kind === 'interval') {
    return intervalLabel(Number(row.intervalMinutes || 0));
  }
  if (row.kind === 'once') return 'یک بار';
  const days = normalizeDays(row.days);
  const when = days.length === 0 ? 'هر روز' : days.map((day) => WEEKDAY_LABELS[day] ?? String(day)).join('، ');
  const clock = normalizeClockTimes(row.times).join(' و ');
  return `${when} — ساعت ${clock}`;
}

function serializeSchedule(row: any, groupTitleOf: Map<string, string>) {
  const tz = safeTimezone(row.timezone);
  const now = new Date();
  const upcoming = upcomingRuns({ ...row, timezone: tz }, now, 3);
  return {
    id: row.id,
    name: row.name,
    botId: row.botId,
    chatIds: row.chatIds,
    groups: row.chatIds.map((id: string) => ({ chatId: id, title: groupTitleOf.get(id) || id })),
    kind: row.kind,
    times: normalizeClockTimes(row.times),
    days: normalizeDays(row.days),
    intervalMinutes: row.intervalMinutes,
    onceAt: row.onceAt,
    timezone: tz,
    isActive: row.isActive,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    lastResult: row.lastResult,
    runCount: row.runCount,
    createdAt: row.createdAt,
    label: scheduleLabel(row),
    nextRunLabel: row.nextRunAt ? wallClockLabel(tz, new Date(row.nextRunAt)) : null,
    lastRunLabel: row.lastRunAt ? wallClockLabel(tz, new Date(row.lastRunAt)) : null,
    upcoming: upcoming.map((at) => ({ at, label: wallClockLabel(tz, at) })),
  };
}

/** عنوان گروه‌های ثبت‌شده، برای نمایش در فهرست زمان‌بندی‌ها */
async function groupTitlesOf(rows: any[]): Promise<Map<string, string>> {
  const chatIds = new Set<string>();
  for (const row of rows) for (const id of row.chatIds) chatIds.add(String(id));
  const out = new Map<string, string>();
  if (chatIds.size === 0) return out;
  const found = await prisma.groupChat.findMany({
    where: { chatId: { in: [...chatIds].filter((id) => /^-?\d+$/.test(id)).map((id) => BigInt(id)) } },
    select: { chatId: true, title: true },
  });
  for (const group of found) out.set(group.chatId.toString(), group.title || group.chatId.toString());
  return out;
}

interface ParsedSchedule {
  name: string | null;
  botId: number;
  chatIds: string[];
  kind: string;
  times: string[];
  days: number[];
  intervalMinutes: number | null;
  onceAt: Date | null;
  timezone: string;
  isActive: boolean;
}

/**
 * بدنهٔ پنل را می‌سنجد. خطا متن فارسی است تا مستقیم در پنل نشان داده شود.
 * groups باید در جدول group_chats همان ربات باشند (پخش خودکار فقط در گروهی کار
 * می‌کند که ربات عضو آن است و آن را دیده است).
 */
async function parseScheduleBody(body: any, existing: any | null): Promise<{ error?: string; data?: ParsedSchedule }> {
  const timezone = safeTimezone(body?.timezone ?? existing?.timezone);

  const nameRaw = body?.name ?? existing?.name ?? null;
  const name = nameRaw === null || nameRaw === undefined ? null : String(nameRaw).trim().slice(0, 64);

  const botIdRaw = body?.botId ?? existing?.botId;
  const botId = Number.parseInt(String(botIdRaw ?? ''), 10);
  if (!Number.isInteger(botId)) return { error: 'ربات را انتخاب کنید' };
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { id: true, isActive: true, name: true } });
  if (!bot) return { error: 'ربات پیدا نشد؛ آن را در بخش «ربات‌ها» ثبت کنید' };

  const chatIdsRaw = body?.chatIds ?? existing?.chatIds ?? [];
  const chatIds = [
    ...new Set(
      (Array.isArray(chatIdsRaw) ? chatIdsRaw : [chatIdsRaw])
        .map((id: any) => String(id ?? '').trim())
        .filter((id: string) => /^-?\d+$/.test(id))
    ),
  ].slice(0, MAX_GROUPS_PER_SCHEDULE + 1);
  if (chatIds.length === 0) return { error: 'حداقل یک گروه را انتخاب کنید' };
  if (chatIds.length > MAX_GROUPS_PER_SCHEDULE) {
    return { error: `حداکثر ${MAX_GROUPS_PER_SCHEDULE} گروه برای هر زمان‌بندی` };
  }

  const kindRaw = String(body?.kind ?? existing?.kind ?? 'daily').trim();
  const kind = SCHEDULE_KINDS.includes(kindRaw as any) ? kindRaw : '';
  if (!kind) return { error: 'نوع زمان‌بندی معتبر نیست' };

  const times = normalizeClockTimes(body?.times ?? existing?.times ?? []);
  const days = normalizeDays(body?.days ?? existing?.days ?? []);

  let intervalMinutes: number | null = null;
  if (kind === 'interval') {
    const raw = body?.intervalMinutes ?? existing?.intervalMinutes;
    intervalMinutes = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isInteger(intervalMinutes)) return { error: 'فاصلهٔ زمانی را وارد کنید (دقیقه)' };
    if (intervalMinutes < MIN_INTERVAL_MINUTES || intervalMinutes > MAX_INTERVAL_MINUTES) {
      return {
        error: `فاصله باید بین ${MIN_INTERVAL_MINUTES} دقیقه تا ${MAX_INTERVAL_MINUTES / 60 / 24} روز باشد`,
      };
    }
  }

  let onceAt: Date | null = null;
  if (kind === 'once') {
    onceAt = parseWhen(body?.onceAt ?? existing?.onceAt, timezone);
    if (!onceAt) return { error: 'تاریخ و ساعت ارسال را وارد کنید' };
  }

  const isActiveRaw = body?.isActive ?? existing?.isActive ?? true;
  const isActive = isActiveRaw === true || String(isActiveRaw) === 'true' || String(isActiveRaw) === '1';

  if (kind === 'daily' && times.length === 0) {
    return { error: `حداقل یک ساعت «HH:MM» وارد کنید (حداکثر ${MAX_TIMES_PER_SCHEDULE})` };
  }

  // ربات غیرفعال هیچ‌وقت ارسال نمی‌کند → از همان ابتدا روشن نکنید
  if (!bot.isActive) return { error: `ربات «${bot.name}» در پنل غیرفعال است` };

  // گروه‌ها باید برای همین ربات ثبت شده باشند
  const known = await prisma.groupChat.findMany({
    where: { botId, chatId: { in: chatIds.map((id) => BigInt(id)) } },
    select: { chatId: true, isJoined: true, title: true },
  });
  const knownIds = new Set(known.map((group) => group.chatId.toString()));
  const unknown = chatIds.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    return {
      error: `این گروه‌ها در فهرست گروه‌های «${bot.name}» نیستند: ${unknown.slice(0, 3).join('، ')}`,
    };
  }
  const leftGroups = known.filter((group) => !group.isJoined).map((group) => group.title || '—');
  if (leftGroups.length > 0) {
    return { error: `ربات دیگر عضو این گروه‌ها نیست: ${leftGroups.slice(0, 3).join('، ')}` };
  }

  return { data: { name: name || null, botId, chatIds, kind, times, days, intervalMinutes, onceAt, timezone, isActive } };
}

/** یک سطر را با نام ربات و عنوان گروه‌ها برای پنل آماده می‌کند */
async function schedulePayload(row: any) {
  const titles = await groupTitlesOf([row]);
  const bot = await prisma.bot.findUnique({ where: { id: row.botId }, select: { name: true } });
  return { ...serializeSchedule(row, titles), botName: bot?.name ?? null };
}

// ─── فهرست زمان‌بندی‌ها ──────────────────────
router.get('/schedules', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await prisma.musicSchedule.findMany({ orderBy: [{ isActive: 'desc' }, { id: 'desc' }] });
    const [groupTitleOf, bots] = await Promise.all([
      groupTitlesOf(rows),
      prisma.bot.findMany({ select: { id: true, name: true } }),
    ]);
    const nameOf = new Map(bots.map((bot) => [bot.id, bot.name]));

    const schedules = rows.map((row) => ({
      ...serializeSchedule(row, groupTitleOf),
      botName: nameOf.get(row.botId) || null,
    }));
    res.json({ total: schedules.length, maxSchedules: MAX_SCHEDULES, schedules });
  } catch (error) {
    console.error('Music schedules list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── پیش‌نمایش ساعت‌های آینده (قبل از ذخیره) ─
router.post('/schedules/preview', async (req: AuthRequest, res: Response) => {
  try {
    const timezone = safeTimezone(req.body?.timezone);
    const kind = String(req.body?.kind ?? 'daily');
    const shape = {
      kind: SCHEDULE_KINDS.includes(kind as any) ? kind : 'daily',
      times: normalizeClockTimes(req.body?.times ?? []),
      days: normalizeDays(req.body?.days ?? []),
      intervalMinutes: Number.parseInt(String(req.body?.intervalMinutes ?? ''), 10) || null,
      onceAt: parseWhen(req.body?.onceAt, timezone),
      timezone,
    };
    const now = new Date();
    const upcoming = upcomingRuns(shape, now, 3);
    res.json({
      ok: upcoming.length > 0,
      timezone,
      label: scheduleLabel(shape),
      upcoming: upcoming.map((at) => ({ at, label: wallClockLabel(timezone, at) })),
      error: upcoming.length === 0 ? 'زمان بعدی‌ای از این تنظیم ساخته نمی‌شود' : undefined,
    });
  } catch (error) {
    console.error('Music schedule preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ساخت زمان‌بندی ─────────────────────────
router.post('/schedules', async (req: AuthRequest, res: Response) => {
  try {
    const total = await prisma.musicSchedule.count();
    if (total >= MAX_SCHEDULES) {
      return res.status(400).json({ error: `حداکثر ${MAX_SCHEDULES} زمان‌بندی ثبت شده است` });
    }

    const parsed = await parseScheduleBody(req.body ?? {}, null);
    if (parsed.error || !parsed.data) return res.status(400).json({ error: parsed.error || 'دادهٔ زمان‌بندی کامل نیست' });

    const data = parsed.data;
    if (data.kind === 'once' && (data.onceAt as Date).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'زمان ارسال یک‌بارمصرف باید در آینده باشد' });
    }

    const nextRunAt = computeNextRunAt({ ...data }, new Date());
    if (!nextRunAt) return res.status(400).json({ error: 'زمان بعدی‌ای برای این تنظیم پیدا نشد' });

    const row = await prisma.musicSchedule.create({ data: { ...data, nextRunAt } });
    res.json({ success: true, schedule: await schedulePayload(row) });
  } catch (error) {
    console.error('Music schedule create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ویرایش / روشن و خاموش کردن ─────────────
router.patch('/schedules/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });

    const existing = await prisma.musicSchedule.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'زمان‌بندی پیدا نشد' });

    const parsed = await parseScheduleBody(req.body ?? {}, existing);
    if (parsed.error || !parsed.data) return res.status(400).json({ error: parsed.error || 'دادهٔ زمان‌بندی کامل نیست' });

    const data = parsed.data;
    const timingChanged =
      data.kind !== existing.kind ||
      data.timezone !== existing.timezone ||
      JSON.stringify(data.times) !== JSON.stringify(normalizeClockTimes(existing.times)) ||
      JSON.stringify(data.days) !== JSON.stringify(normalizeDays(existing.days)) ||
      data.intervalMinutes !== existing.intervalMinutes ||
      String(data.onceAt) !== String(existing.onceAt);
    const reactivated = data.isActive && !existing.isActive;

    let nextRunAt = existing.nextRunAt;
    if (!data.isActive) {
      // خاموش: ساعت بعدی نگه داشته نمی‌شود تا با روشن کردن دوباره، پیامِ دیرهنگام
      // بلافاصله ارسال نشود
      nextRunAt = null;
    } else if (timingChanged || reactivated || !nextRunAt) {
      nextRunAt = computeNextRunAt({ ...data }, new Date());
      if (!nextRunAt) return res.status(400).json({ error: 'زمان بعدی‌ای برای این تنظیم پیدا نشد' });
    }

    const row = await prisma.musicSchedule.update({ where: { id }, data: { ...data, nextRunAt } });
    res.json({ success: true, schedule: await schedulePayload(row) });
  } catch (error) {
    console.error('Music schedule update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── حذف زمان‌بندی ──────────────────────────
router.delete('/schedules/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });

    const existing = await prisma.musicSchedule.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'زمان‌بندی پیدا نشد' });

    await prisma.musicSchedule.delete({ where: { id } });
    res.json({ success: true, removedGroups: existing.chatIds.length });
  } catch (error) {
    console.error('Music schedule delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── همین حالا امتحان کن ────────────────────
// همان کاری که تایکر در ساعت مقرر می‌کند، ولی برنامه جابه‌جا نمی‌شود
// (nextRunAt دست‌نخورده می‌ماند تا ساعت بعدی گم نشود).
router.post('/schedules/:id/run', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });

    const existing = await prisma.musicSchedule.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'زمان‌بندی پیدا نشد' });

    const report = await runScheduleNow(id);
    res.json({
      success: report.sent > 0,
      report,
      schedule: await schedulePayload(existing),
    });
  } catch (error: any) {
    if (error?.message === 'not-found') return res.status(404).json({ error: 'زمان‌بندی پیدا نشد' });
    console.error('Music schedule run error:', error?.description || error?.message || error);
    res.status(500).json({ error: error?.description || 'اجرای زمان‌بندی ناموفق بود' });
  }
});

// ─── آپلود آهنگ به کتابخانهٔ مشترک ───────────
// فایل به‌صورت base64 در JSON می‌آید (بدون وابستگی multer) و روی volume مشترک
// ذخیره می‌شود؛ قالب ویس در اولین پخش با ffmpeg ساخته می‌شود.
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { title, artist, fileName, mimeType, dataBase64 } = req.body ?? {};

    if (!dataBase64 || typeof dataBase64 !== 'string') {
      return res.status(400).json({ error: 'فایل آهنگ ارسال نشده است' });
    }
    if (!isAudioFileName(fileName, mimeType)) {
      return res
        .status(400)
        .json({ error: 'فایل باید آهنگ باشد (mp3، m4a، aac، ogg، opus، flac یا wav)' });
    }

    const raw = String(dataBase64).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'فایل خالی یا ناشناخته است' });
    }

    const limit = await maxUploadBytes();
    if (buffer.length > limit) {
      return res
        .status(400)
        .json({ error: `حجم آهنگ بیشتر از ${Math.round(limit / 1024 / 1024)} مگابایت است` });
    }

    const ext = audioExtension(mimeType, fileName);
    let filePath: string;
    try {
      filePath = saveAudioFile(buffer, ext);
    } catch (error) {
      console.error('Music save error:', error);
      return res.status(500).json({ error: 'ذخیرهٔ فایل روی سرور ناموفق بود' });
    }

    const track = await prisma.musicTrack.create({
      data: {
        title: cleanMusicTitle(title || fileName || 'آهنگ'),
        artist: artist ? String(artist).slice(0, 64) : null,
        filePath,
        fileSize: buffer.length,
        mimeType: mimeType || `audio/${ext}`,
        source: 'panel',
      },
    });

    res.json({ success: true, track: serializeTrack(track) });
  } catch (error) {
    console.error('Music upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ویرایش / فعال و غیرفعال کردن ────────────
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });

    const existing = await prisma.musicTrack.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'آهنگ پیدا نشد' });

    const data: any = {};
    if (typeof req.body?.title === 'string' && req.body.title.trim()) {
      data.title = cleanMusicTitle(req.body.title);
    }
    if (typeof req.body?.artist === 'string') data.artist = req.body.artist.slice(0, 64) || null;
    if (typeof req.body?.isActive === 'boolean') data.isActive = req.body.isActive;

    const track = await prisma.musicTrack.update({ where: { id }, data });
    res.json({ success: true, track: serializeTrack(track) });
  } catch (error) {
    console.error('Music update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── حذف آهنگ ────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });

    const track = await prisma.musicTrack.findUnique({ where: { id } });
    if (!track) return res.status(404).json({ error: 'آهنگ پیدا نشد' });

    await prisma.musicTrack.delete({ where: { id } });
    const removedFile = removeAudioFile(track.filePath);
    // خروجی ویسِ تبدیل‌شدهٔ همان آهنگ دیگر بی‌استفاده است
    removeVoiceCache(id);

    res.json({ success: true, removedFile });
  } catch (error) {
    console.error('Music delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── پخش در گروه از پنل ─────────────────────
// همان مسیری که دستور /play در گروه می‌رود: آهنگ به‌شکل ویس با کپشن نام آهنگ و
// آیدی ربات فرستاده می‌شود، بدون متن اضافه و بدون دکمه.
router.post('/:id/play', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const chatId = String(req.body?.chatId || '').trim();
    const botIdRaw = req.body?.botId;
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });
    if (!chatId) return res.status(400).json({ error: 'گروه را انتخاب کنید' });

    const track = await prisma.musicTrack.findUnique({ where: { id } });
    if (!track) return res.status(404).json({ error: 'آهنگ پیدا نشد' });

    // ربات از گروه انتخاب می‌شود؛ اگر پنل مستقیم ربات داد همان رعایت می‌شود
    let botId = botIdRaw === undefined || botIdRaw === null ? NaN : parseInt(String(botIdRaw), 10);
    if (!Number.isInteger(botId)) {
      const group = await prisma.groupChat
        .findFirst({ where: { chatId: BigInt(chatId) }, select: { botId: true } })
        .catch(() => null);
      botId = Number(group?.botId ?? NaN);
    }
    if (!Number.isInteger(botId)) {
      return res.status(400).json({ error: 'ربات این گروه مشخص نیست' });
    }

    const bot = getBotInstance(botId);
    if (!bot) return res.status(400).json({ error: 'ربات مربوطه فعال نیست' });

    const result = await playTrackInChat({
      telegram: bot.telegram,
      botId,
      chatId,
      track,
      requestName: 'پنل مدیریت',
    });

    if (!result.ok) {
      return res.status(400).json({ error: result.reason || 'پخش آهنگ ناموفق بود' });
    }

    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error('Music panel play error:', error?.description || error?.message || error);
    res.status(500).json({ error: error?.description || 'پخش آهنگ ناموفق بود' });
  }
});

export const musicRouter = router;
