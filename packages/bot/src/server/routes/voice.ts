import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { getSettingBool } from '../../lib/settings.js';
import { audioFileExists } from '../../lib/music-library.js';
import { registerMusicPlay } from '../../bot/music.js';
import { streamInVoiceCall, voicePlayOptions } from '../../lib/music-voice.js';
import { voiceApi } from '../../lib/voice-client.js';

const router = Router();

/**
 * پنل ↔ سرویس ویس‌کال.
 *
 * هیچ‌چیز در دیتابیس ذخیره نمی‌شود: کلید API، حساب‌ها و سشن‌ها فقط داخل
 * کانتینر sulduz-voice و روی ./data/voice (فایل‌های ۰۶۰۰) می‌مانند. این‌جا
 * فقط درخواست‌ها را به آن سرویس داخلی می‌فرستیم و پاسخ فارسی آن را به پنل
 * می‌دهیم.
 */

function fail(res: Response, result: { error?: string; status?: number }, fallback = 'عملیات ناموفق بود') {
  const status = result.status && result.status >= 400 && result.status < 600 ? result.status : 400;
  res.status(status).json({ error: result.error || fallback });
}

// ─── وضعیت کلی بخش ──────────────────────────
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const [enabled, health, accounts, options] = await Promise.all([
      getSettingBool('music_voice_enabled'),
      voiceApi.health(),
      voiceApi.listAccounts(),
      voicePlayOptions(),
    ]);

    res.json({
      service: {
        available: Boolean(health.ok),
        error: health.ok ? null : health.error,
        version: health.data?.version ?? null,
        ffmpeg: health.data?.ffmpeg ?? null,
        hasApiKeys: Boolean(health.data?.hasApiKeys),
        apiIdMasked: health.data?.apiIdMasked ?? null,
        musicFiles: health.data?.musicFiles ?? 0,
      },
      enabled,
      options,
      accounts: accounts.ok ? accounts.data?.accounts ?? [] : [],
      accountsError: accounts.ok ? null : accounts.error,
      streams: accounts.ok ? accounts.data?.streams ?? [] : [],
      activeStreams: accounts.ok ? accounts.data?.activeStreams ?? 0 : 0,
    });
  } catch (error) {
    console.error('Voice status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── کلید API ────────────────────────────────
router.post('/config', async (req: AuthRequest, res: Response) => {
  try {
    const apiId = String(req.body?.apiId ?? '').trim();
    const apiHash = String(req.body?.apiHash ?? '').trim();
    const result = await voiceApi.setConfig(apiId, apiHash);
    if (!result.ok) return fail(res, result, 'کلید API پذیرفته نشد');
    res.json({ success: true, apiIdMasked: result.data?.apiIdMasked ?? null });
  } catch (error) {
    console.error('Voice config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/config', async (_req: AuthRequest, res: Response) => {
  try {
    const result = await voiceApi.clearConfig();
    if (!result.ok) return fail(res, result, 'پاک کردن کلید ناموفق بود');
    res.json({ success: true });
  } catch (error) {
    console.error('Voice config clear error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ورود سه مرحله‌ای حساب ──────────────────
router.post('/login/start', async (req: AuthRequest, res: Response) => {
  try {
    const phone = String(req.body?.phone ?? '').trim();
    const label = String(req.body?.label ?? '').trim();
    const result = await voiceApi.loginStart(phone, label);
    if (!result.ok) return fail(res, result, 'ارسال کد ناموفق بود');
    res.json({ success: true, ...result.data });
  } catch (error) {
    console.error('Voice login start error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login/confirm', async (req: AuthRequest, res: Response) => {
  try {
    const token = String(req.body?.token ?? '').trim();
    const code = req.body?.code === undefined || req.body.code === null ? undefined : String(req.body.code).trim();
    const password = req.body?.password ? String(req.body.password) : undefined;
    const result = await voiceApi.loginConfirm(token, code, password);
    if (!result.ok) return fail(res, result, 'ورود به حساب ناموفق بود');
    res.json({ success: true, ...result.data });
  } catch (error) {
    console.error('Voice login confirm error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const token = String(req.body?.token ?? '').trim();
    const result = await voiceApi.loginCancel(token);
    if (!result.ok) return fail(res, result, 'لغو ورود ناموفق بود');
    res.json({ success: true });
  } catch (error) {
    console.error('Voice login cancel error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── حساب‌ها ─────────────────────────────────
router.post('/accounts/connect', async (req: AuthRequest, res: Response) => {
  try {
    const result = await voiceApi.connectAccount(String(req.body?.id ?? '').trim());
    if (!result.ok) return fail(res, result, 'اتصال حساب ناموفق بود');
    res.json({ success: true, ...result.data });
  } catch (error) {
    console.error('Voice account connect error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/accounts/logout', async (req: AuthRequest, res: Response) => {
  try {
    const result = await voiceApi.logoutAccount(String(req.body?.id ?? '').trim());
    if (!result.ok) return fail(res, result, 'خروج از حساب ناموفق بود');
    res.json({ success: true });
  } catch (error) {
    console.error('Voice account logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/accounts/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await voiceApi.deleteAccount(String(req.params.id ?? '').trim());
    if (!result.ok) return fail(res, result, 'حذف حساب ناموفق بود');
    res.json({ success: true });
  } catch (error) {
    console.error('Voice account delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── پخش آزمایشی در گروه (از پنل) ──────────
router.post('/play', async (req: AuthRequest, res: Response) => {
  try {
    const chatId = Number(String(req.body?.chatId ?? '').trim());
    const trackId = Number(req.body?.trackId);
    if (!Number.isFinite(chatId) || !chatId) return res.status(400).json({ error: 'شناسهٔ گروه معتبر نیست' });
    if (!Number.isInteger(trackId)) return res.status(400).json({ error: 'آهنگ را انتخاب کنید' });

    const track = await prisma.musicTrack.findUnique({ where: { id: trackId } });
    if (!track) return res.status(404).json({ error: 'آهنگ پیدا نشد' });
    // از پنل فقط آهنگی را می‌توان در ویس‌کال پخش کرد که فایلش روی سرور باشد
    if (!audioFileExists(track.filePath)) {
      return res
        .status(400)
        .json({ error: 'فایل این آهنگ روی سرور نیست. آهنگی را انتخاب کنید که از پنل آپلود شده است.' });
    }

    const options = await voicePlayOptions();
    const relative = String(track.filePath || '');
    const result = await streamInVoiceCall({
      chatId,
      path: relative,
      title: track.title,
      duration: track.duration ?? 0,
    });
    if (!result.ok) {
      return res.status(result.status && result.status >= 400 ? result.status : 400).json({
        error: result.error || 'پخش در ویس‌کال ناموفق بود',
      });
    }

    await registerMusicPlay({
      trackId: track.id,
      botId: track.botId,
      chatId,
      requestName: 'پنل',
      mode: 'voice',
      status: 'PLAYING',
    });
    await prisma.musicTrack
      .update({ where: { id: track.id }, data: { playCount: { increment: 1 } } })
      .catch(() => undefined);

    res.json({ success: true, stream: result.data?.stream ?? null, options });
  } catch (error) {
    console.error('Voice play error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/stop', async (req: AuthRequest, res: Response) => {
  try {
    const chatId = Number(String(req.body?.chatId ?? '').trim());
    if (!Number.isFinite(chatId) || !chatId) return res.status(400).json({ error: 'شناسهٔ گروه معتبر نیست' });
    const result = await voiceApi.stop(chatId);
    if (!result.ok) return fail(res, result, 'توقف پخش ناموفق بود');

    const open = await prisma.musicPlay.findMany({
      where: { chatId: BigInt(chatId), status: 'PLAYING', mode: 'voice' },
      select: { id: true },
    });
    for (const row of open) {
      await prisma.musicPlay
        .update({ where: { id: row.id }, data: { status: 'STOPPED', endedAt: new Date() } })
        .catch(() => undefined);
    }
    res.json({ success: true, closed: open.length });
  } catch (error) {
    console.error('Voice stop error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const voiceRouter = router;
