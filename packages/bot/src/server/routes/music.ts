import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { getSettingNumber } from '../../lib/settings.js';
import { getBotInstance } from '../../bot/index.js';
import { playTrackInChat, reconcileMusicPlays } from '../../bot/music.js';
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
