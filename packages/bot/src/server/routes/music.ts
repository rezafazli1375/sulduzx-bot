import fs from 'node:fs';
import path from 'node:path';
import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { getSettingNumber } from '../../lib/settings.js';
import { getBotInstance } from '../../bot/index.js';
import { reconcileMusicPlays, registerMusicPlay } from '../../bot/music.js';
import { stopVoiceCall } from '../../lib/music-voice.js';
import {
  MUSIC_DEFAULT_MAX_MB,
  audioExtension,
  audioFileExists,
  cleanMusicTitle,
  isAudioFileName,
  removeAudioFile,
  saveAudioFile,
} from '../../lib/music-library.js';

const router = Router();

/** حالت «در حال پخش» بیشتر از این مدت معتبر نیست (ربات ری‌استارت شده باشد) */
const NOW_PLAYING_WINDOW_MS = 3 * 60 * 60_000;

async function maxUploadBytes(): Promise<number> {
  const configured = await getSettingNumber('music_max_mb');
  const mb = configured > 0 ? configured : MUSIC_DEFAULT_MAX_MB;
  // سقف سخت ۲۰ مگابایت: بدنهٔ base64 از محدودیت ۴۵ مگابایت API رد نشود
  return Math.min(Math.max(1, mb), 20) * 1024 * 1024;
}

/** تبدیل خروجی Prisma به چیزی که مرورگر safely می‌خواند (BigInt → رشته) */
function serializeTrack(track: any) {
  return {
    id: track.id,
    botId: track.botId,
    botName: track.bot?.name ?? null,
    title: track.title,
    artist: track.artist,
    kind: track.kind,
    duration: track.duration,
    fileSize: track.fileSize,
    mimeType: track.mimeType,
    playCount: track.playCount,
    isActive: track.isActive,
    source: track.source,
    hasFileId: Boolean(track.fileId),
    hasLocalFile: audioFileExists(track.filePath),
    createdAt: track.createdAt,
  };
}

// ─── فهرست آهنگ‌ها ────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const botIdRaw = req.query?.botId;
    const botId =
      botIdRaw !== undefined && botIdRaw !== '' ? parseInt(String(botIdRaw), 10) : undefined;

    const where: any = {};
    if (botId && Number.isInteger(botId)) where.botId = botId;

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
      include: { bot: { select: { name: true } } },
      take: 500,
    });

    res.json({ total: tracks.length, tracks: tracks.map(serializeTrack) });
  } catch (error) {
    console.error('Music list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── آمار موزیک + آنچه همین حالا پخش می‌شود ──
router.get('/stats', async (req: AuthRequest, res: Response) => {
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
          track: { select: { title: true, artist: true, kind: true } },
          group: { select: { title: true, username: true, memberCount: true } },
        },
      }),
      prisma.musicTrack.count(),
      prisma.musicTrack.count({ where: { isActive: true } }),
    ]);

    res.json({
      totalPlays,
      playsToday,
      totalTracks,
      activeTracks,
      nowPlayingCount: nowPlaying.length,
      nowPlaying: nowPlaying.map((play) => ({
        id: play.id,
        botId: play.botId,
        chatId: play.chatId.toString(),
        groupTitle: play.group?.title || 'گروه ناشناس',
        groupUsername: play.group?.username || null,
        memberCount: play.group?.memberCount ?? null,
        title: play.track?.title || '—',
        artist: play.track?.artist || null,
        requestName: play.requestName,
        mode: play.mode,
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

// ─── گروه‌ها و محل پخش آهنگ در هر گروه ───────
// music_mode روی group_chats: default از تنظیم سراسری پیروی می‌کند،
// chat پیام صوتی در چت و voice استریم داخل ویس‌کال همان گروه.
const PLAYBACK_MODES = new Set(['default', 'chat', 'voice']);

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
        musicMode: true,
        lastSeenAt: true,
      },
    });

    res.json({
      total: groups.length,
      groups: groups.map((group) => ({
        ...group,
        chatId: group.chatId.toString(),
        musicMode: PLAYBACK_MODES.has(group.musicMode) ? group.musicMode : 'default',
      })),
    });
  } catch (error) {
    console.error('Music groups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/groups/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });

    const mode = String(req.body?.mode ?? '').trim().toLowerCase();
    if (!PLAYBACK_MODES.has(mode)) {
      return res.status(400).json({ error: 'حالت پخش باید default، chat یا voice باشد' });
    }

    const group = await prisma.groupChat
      .findUnique({
        where: { id },
        select: { id: true, chatId: true, musicMode: true },
      })
      .catch(() => null);
    if (!group) return res.status(404).json({ error: 'گروه پیدا نشد' });

    if (group.musicMode !== mode) {
      await prisma.groupChat.update({ where: { id }, data: { musicMode: mode } });
    }

    // وقتی گروه از ویس‌کال به چت برمی‌گردد، استریم باز مانده باید بسته شود تا
    // دو مسیر هم‌زمان صدا ندهند.
    if (mode !== 'voice') {
      await stopVoiceCall(Number(group.chatId)).catch(() => undefined);
    }

    const updated = await prisma.groupChat.findUnique({
      where: { id },
      select: { id: true, botId: true, chatId: true, title: true, musicMode: true },
    });

    res.json({
      success: true,
      group: updated ? { ...updated, chatId: updated.chatId.toString() } : null,
    });
  } catch (error) {
    console.error('Music group mode error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── آپلود آهنگ از پنل ───────────────────────
// فایل به‌صورت base64 در JSON می‌آید (بدون وابستگی multer). آهنگ روی volume
// مشترک ذخیره می‌شود؛ file_id تلگرام در اولین پخش ساخته و ذخیره می‌شود.
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { botId: botIdRaw, title, artist, fileName, mimeType, dataBase64 } = req.body ?? {};
    const botId = parseInt(String(botIdRaw ?? ''), 10);

    if (!Number.isInteger(botId)) {
      return res.status(400).json({ error: 'ربات را انتخاب کنید' });
    }
    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) return res.status(404).json({ error: 'ربات پیدا نشد' });

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
      filePath = saveAudioFile(botId, buffer, ext);
    } catch (error) {
      console.error('Music save error:', error);
      return res.status(500).json({ error: 'ذخیرهٔ فایل روی سرور ناموفق بود' });
    }

    const track = await prisma.musicTrack.create({
      data: {
        botId,
        title: cleanMusicTitle(title || fileName || 'آهنگ'),
        artist: artist ? String(artist).slice(0, 64) : null,
        fileId: null,
        filePath,
        fileSize: buffer.length,
        mimeType: mimeType || `audio/${ext}`,
        kind: 'audio',
        source: 'panel',
      },
    });

    res.json({ success: true, track: serializeTrack({ ...track, bot }) });
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

    const track = await prisma.musicTrack.update({
      where: { id },
      data,
      include: { bot: { select: { name: true } } },
    });
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

    res.json({ success: true, removedFile });
  } catch (error) {
    console.error('Music delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── پخش در گروه از پنل (آزمایش) ────────────
// ربات آهنگ را در گروه انتخاب‌شده پخش می‌کند؛ همان مسیری که دکمهٔ گروه می‌رود.
router.post('/:id/play', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const chatId = String(req.body?.chatId || '').trim();
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'شناسه نامعتبر است' });
    if (!chatId) return res.status(400).json({ error: 'گروه را انتخاب کنید' });

    const track = await prisma.musicTrack.findUnique({ where: { id } });
    if (!track) return res.status(404).json({ error: 'آهنگ پیدا نشد' });

    const bot = getBotInstance(track.botId);
    if (!bot) return res.status(400).json({ error: 'ربات مربوطه فعال نیست' });

    const localFile = audioFileExists(track.filePath) ? (track.filePath as string) : null;
    const payload: any =
      track.fileId ||
      (localFile ? { source: fs.createReadStream(localFile), filename: path.basename(localFile) } : null);
    if (!payload) return res.status(400).json({ error: 'فایل این آهنگ روی سرور نیست' });

    const sent: any =
      track.kind === 'document'
        ? await bot.telegram.sendDocument(chatId, payload, { caption: `🎵 ${track.title}` })
        : await bot.telegram.sendAudio(chatId, payload, {
            title: track.title,
            ...(track.artist ? { performer: track.artist.slice(0, 64) } : {}),
          });

    const fileId = sent?.audio?.file_id || sent?.document?.file_id;
    if (fileId && !track.fileId) {
      await prisma.musicTrack.update({ where: { id }, data: { fileId } }).catch(() => undefined);
    }
    await prisma.musicTrack.update({ where: { id }, data: { playCount: { increment: 1 } } }).catch(() => undefined);
    await registerMusicPlay({
      trackId: id,
      botId: track.botId,
      chatId: BigInt(chatId),
      messageId: typeof sent?.message_id === 'number' ? sent.message_id : null,
      status: 'PLAYING',
    });

    res.json({ success: true, messageId: sent?.message_id });
  } catch (error: any) {
    console.error('Music panel play error:', error?.description || error?.message || error);
    res.status(500).json({ error: error?.description || 'پخش آهنگ ناموفق بود' });
  }
});

export const musicRouter = router;
