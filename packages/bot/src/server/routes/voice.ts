import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { getSetting, setSetting } from '../../lib/settings.js';
import { voiceApi } from '../../lib/voice-client.js';
import {
  nextRadioTrack,
  radioGroupStatus,
  radioOptions,
  startRadio,
  stopAllRadio,
  stopRadio,
  voiceCallEnabled,
} from '../../bot/voicecall.js';

/**
 * پنل ↔ رادیوی ویس‌کال.
 *
 * هیچ رازی در دیتابیس ما نمی‌نشیند: api_id/api_hash، شمارهٔ مجازی و رشتهٔ سشن
 * فقط داخل کانتینر sulduz-voice و روی ./data/voice (فایل‌های ۰۶۰۰) می‌مانند.
 * این‌جا درخواست‌ها به همان سرویس داخلی فرستاده می‌شوند و پاسخ فارسی‌اش به پنل
 * برمی‌گردد. کاری که خود پنل تنظیم می‌کند فقط کلیدهای voicecall_* در جدول
 * settings است (کیفیت، صدا، سقف زمان، سقف هم‌زمان، حساب انتخابی).
 */

const router = Router();

function fail(res: Response, result: { error?: string; status?: number }, fallback = 'عملیات ناموفق بود') {
  const status = result.status && result.status >= 400 && result.status < 600 ? result.status : 400;
  res.status(status).json({ error: result.error || fallback });
}

function chatIdOf(body: any): number | null {
  const raw = String(body?.chatId ?? '').trim();
  const chatId = Number(raw);
  return Number.isFinite(chatId) && chatId !== 0 ? chatId : null;
}

// ─── وضعیت کلی بخش ──────────────────────────
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const [enabled, options, health, accounts, radio] = await Promise.all([
      voiceCallEnabled(),
      radioOptions(),
      voiceApi.health(),
      voiceApi.listAccounts(),
      radioGroupStatus(),
    ]);

    res.json({
      enabled,
      options,
      service: {
        url: voiceApi.url,
        available: Boolean(health.ok),
        error: health.ok ? null : health.error,
        version: health.data?.version ?? null,
        mode: health.data?.mode ?? null,
        ffmpeg: health.data?.ffmpeg ?? null,
        hasApiKeys: Boolean(health.data?.hasApiKeys),
        apiIdMasked: health.data?.apiIdMasked ?? null,
        musicFiles: health.data?.musicFiles ?? 0,
        activeStreams: health.data?.activeStreams ?? 0,
        defaults: health.data?.defaults ?? null,
      },
      accounts: accounts.ok ? accounts.data?.accounts ?? [] : [],
      accountsError: accounts.ok ? null : accounts.error,
      streams: accounts.ok ? accounts.data?.streams ?? [] : [],
      radio,
    });
  } catch (error) {
    console.error('Voice status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── کلید API (api_id / api_hash) ────────────
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

// ─── ورود سه مرحله‌ای حساب تلگرام ────────────
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
    const id = String(req.body?.id ?? '').trim();
    const result = await voiceApi.logoutAccount(id);
    if (!result.ok) return fail(res, result, 'خروج از حساب ناموفق بود');
    // پخش‌های آن حساب سرویس بسته می‌شود؛ tick رادیو در همین round آن را
    // بی‌پخش می‌بیند و رادیوی همان گروه را با پیام فارسی خاموش می‌کند.
    res.json({ success: true });
  } catch (error) {
    console.error('Voice account logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/accounts/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id ?? '').trim();
    const result = await voiceApi.deleteAccount(id);
    if (!result.ok) return fail(res, result, 'حذف حساب ناموفق بود');
    // اگر پنل همان حساب را برای رادیو انتخاب کرده بود، انتخاب پاک می‌شود
    if ((await getSetting('voicecall_account')) === id) await setSetting('voicecall_account', '');
    res.json({ success: true });
  } catch (error) {
    console.error('Voice account delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── کنترل رادیو از پنل ─────────────────────
router.post('/radio/start', async (req: AuthRequest, res: Response) => {
  try {
    const chatId = chatIdOf(req.body);
    if (!chatId) return res.status(400).json({ error: 'شناسهٔ گروه معتبر نیست' });

    const requestedBot = Math.round(Number(req.body?.botId));
    const group = await prisma.groupChat.findFirst({
      where: {
        chatId: BigInt(chatId),
        isJoined: true,
        ...(Number.isInteger(requestedBot) && requestedBot > 0 ? { botId: requestedBot } : {}),
      },
    });
    if (!group) {
      return res
        .status(404)
        .json({ error: 'ربات عضو این گروه نیست یا گروهی با آن ربات در دیتابیس ثبت نشده است.' });
    }

    const startedBy = String(req.body?.startedBy ?? 'پنل').slice(0, 64);
    const result = await startRadio({ botId: group.botId, chatId, startedBy, messageId: null });
    if (!result.ok && !result.session) {
      return res.status(400).json({ error: result.error || 'رادیو روشن نشد' });
    }
    res.json({
      success: result.ok,
      already: !result.ok,
      message: result.error ?? null,
      radio: await radioGroupStatus(),
    });
  } catch (error) {
    console.error('Voice radio start error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/radio/next', async (req: AuthRequest, res: Response) => {
  try {
    const chatId = chatIdOf(req.body);
    if (!chatId) return res.status(400).json({ error: 'شناسهٔ گروه معتبر نیست' });
    const result = await nextRadioTrack(chatId);
    if (!result.ok) return res.status(400).json({ error: result.error || 'آهنگ بعدی پخش نشد' });
    res.json({ success: true, radio: await radioGroupStatus() });
  } catch (error) {
    console.error('Voice radio next error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/radio/stop', async (req: AuthRequest, res: Response) => {
  try {
    const chatId = chatIdOf(req.body);
    if (!chatId) {
      const stopped = await stopAllRadio('از پنل ادمین');
      return res.json({ success: true, stopped: stopped.stopped, radio: await radioGroupStatus() });
    }
    const close = Boolean(req.body?.close);
    const result = await stopRadio(chatId, 'از پنل ادمین', { close });
    if (!result.ok && !result.session) {
      return res.status(400).json({ error: result.error || 'توقف رادیو ناموفق بود' });
    }
    res.json({ success: true, radio: await radioGroupStatus() });
  } catch (error) {
    console.error('Voice radio stop error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── تنظیمات سریع رادیو (همان کلیدهای بخش تنظیمات) ──
const QUALITIES = new Set(['low', 'medium', 'high', 'studio']);

router.post('/options', async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    const writes: Array<[string, string]> = [];

    if (typeof body.enabled === 'boolean') writes.push(['voicecall_enabled', body.enabled ? 'true' : 'false']);
    if (typeof body.autoStart === 'boolean') writes.push(['voicecall_auto_start', body.autoStart ? 'true' : 'false']);
    if (body.quality !== undefined) {
      const quality = String(body.quality).toLowerCase();
      if (!QUALITIES.has(quality)) return res.status(400).json({ error: 'کیفیت صوتی معتبر نیست' });
      writes.push(['voicecall_quality', quality]);
    }
    if (body.volume !== undefined) {
      const volume = Math.round(Number(body.volume));
      if (!Number.isFinite(volume) || volume < 1 || volume > 200) {
        return res.status(400).json({ error: 'صدا باید بین ۱ تا ۲۰۰ باشد' });
      }
      writes.push(['voicecall_volume', String(volume)]);
    }
    if (body.maxMinutes !== undefined) {
      const minutes = Math.round(Number(body.maxMinutes));
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
        return res.status(400).json({ error: 'سقف زمان باید بین ۰ تا ۱۴۴۰ دقیقه باشد (۰ = بی‌سقف)' });
      }
      writes.push(['voicecall_max_minutes', String(minutes)]);
    }
    if (body.maxStreams !== undefined) {
      const streams = Math.round(Number(body.maxStreams));
      if (!Number.isFinite(streams) || streams < 1 || streams > 20) {
        return res.status(400).json({ error: 'حداکثر پخش هم‌زمان باید بین ۱ تا ۲۰ باشد' });
      }
      writes.push(['voicecall_max_streams', String(streams)]);
    }
    if (body.accountId !== undefined) {
      const accountId = String(body.accountId).trim();
      if (accountId) {
        const accounts = await voiceApi.listAccounts();
        const known = (accounts.data?.accounts ?? []).some((account) => String(account.id) === accountId);
        if (!known) return res.status(404).json({ error: 'چنین حسابی در سرویس ویس‌کال ثبت نشده است' });
      }
      writes.push(['voicecall_account', accountId]);
    }

    for (const [key, value] of writes) await setSetting(key, value);
    res.json({ success: true, options: await radioOptions() });
  } catch (error) {
    console.error('Voice options error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const voiceRouter = router;
