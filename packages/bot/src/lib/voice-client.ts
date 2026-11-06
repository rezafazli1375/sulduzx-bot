/**
 * کلاینت سرویس ویس‌کال (sulduz-voice).
 *
 * این سرویس روی شبکهٔ داخلی داکر است و پورتی روی سرور باز نمی‌کند؛ ربات تنها
 * چیزی است که آن را صدا می‌زند. هر خطایی که سرویس با پیام فارسی برمی‌گرداند
 * همان‌طور به پنل/گروه می‌رود و خطای غیرمنتظره با پیام ثابت خودمان.
 *
 * هیچ‌گاه کلید API یا رشتهٔ سشن از این‌جا رد نمی‌شود؛ سرویس خودشان را نگه
 * می‌دارد و فقط اطلاعات ماسک‌شده بیرون می‌دهد.
 */
const VOICE_URL = (process.env.VOICE_URL || 'http://sulduz-voice:8077').replace(/\/+$/, '');

const SHORT_TIMEOUT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 12_000;
/** ورود سه‌مرحله‌ای حساب با تلگرام حرف می‌زند و ممکن است طول بکشد */
const LOGIN_TIMEOUT_MS = 25_000;
/** پیوستن به ویس‌کال و راه‌افتادن ffmpeg ممکن است طول بکشد */
const PLAY_TIMEOUT_MS = 30_000;

export interface VoiceResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  /** پیام فارسی قابل نمایش برای کاربر */
  error?: string;
  code?: string;
}

const UNREACHABLE: VoiceResult = {
  ok: false,
  status: 0,
  error: 'سرویس پخش در ویس‌کال در دسترس نیست (کانتینر sulduz-voice بالا است؟)',
  code: 'unreachable',
};

async function request<T = any>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<VoiceResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${VOICE_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: any = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text.slice(0, 200) };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: String(parsed?.error || `سرویس ویس‌کال خطا داد (${response.status})`),
        code: String(parsed?.code || 'http-error'),
      };
    }
    // بدنه‌های موفق هم می‌توانند {ok:false} داشته باشند (سرویس همان‌طور خطا را
    // در بدنه می‌گذارد)؛ آن‌ها را به همان شکلِ خطا تبدیل می‌کنیم تا فراخوان
    // فقط یک مسیر بررسی کند.
    if (parsed && parsed.ok === false && (parsed.error || parsed.code)) {
      return {
        ok: false,
        status: response.status,
        data: parsed,
        error: String(parsed.error || 'سرویس ویس‌کال خطا داد'),
        code: String(parsed.code || 'service-error'),
      };
    }
    return { ok: true, status: response.status, data: parsed as T };
  } catch (error: any) {
    console.warn('voice request failed:', method, path, error?.name || error?.message || error);
    return { ...UNREACHABLE };
  } finally {
    clearTimeout(timer);
  }
}

export interface VoiceStream {
  chatId: number;
  accountId?: string;
  title?: string;
  status?: string;
  volume?: number;
  duration?: number;
  elapsed?: number;
  remaining?: number;
  startedAt?: number;
  endedAt?: number;
  endReason?: string | null;
}

export interface VoiceAccount {
  id: string;
  phone: string;
  label?: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  dcId?: number | null;
  premium?: boolean;
  status?: string;
  lastError?: string | null;
  hasSession?: boolean;
  connected?: boolean;
}

export interface VoiceHealth {
  ok: boolean;
  service: string;
  version: string;
  mode?: string;
  ffmpeg: boolean;
  hasApiKeys: boolean;
  apiIdMasked: string;
  accounts: number;
  connected: number;
  ready: number;
  activeStreams: number;
  musicRoot: string;
  musicFiles: number;
  defaults?: { maxStreams: number; quality: string; volume: number; autoStart: boolean };
}

export const voiceApi = {
  url: VOICE_URL,

  health: () => request<VoiceHealth>('GET', '/health', undefined, SHORT_TIMEOUT_MS),

  getConfig: () => request<any>('GET', '/config'),
  setConfig: (apiId: string, apiHash: string) => request<any>('POST', '/config', { apiId, apiHash }),
  clearConfig: () => request<any>('DELETE', '/config'),

  loginStart: (phone: string, label?: string) =>
    request<any>('POST', '/login/start', { phone, label }, LOGIN_TIMEOUT_MS),
  loginConfirm: (token: string, code?: string, password?: string) =>
    request<any>('POST', '/login/confirm', { token, code, password }, LOGIN_TIMEOUT_MS),
  loginCancel: (token: string) => request<any>('POST', '/login/cancel', { token }, LOGIN_TIMEOUT_MS),

  listAccounts: () =>
    request<{ accounts: VoiceAccount[]; activeStreams: number; streams: VoiceStream[] }>('GET', '/accounts'),
  connectAccount: (id: string) => request<any>('POST', '/accounts/connect', { id }),
  logoutAccount: (id: string) => request<any>('POST', '/accounts/logout', { id }, LOGIN_TIMEOUT_MS),
  deleteAccount: (id: string) => request<any>('DELETE', `/accounts/${encodeURIComponent(id)}`),

  play: (input: {
    chatId: number | string;
    path: string;
    accountId?: string;
    title?: string;
    duration?: number;
    quality?: string;
    volume?: number;
    autoStart?: boolean;
    maxStreams?: number;
    loop?: boolean;
  }) => request<{ playing: boolean; stream: VoiceStream }>('POST', '/play', input, PLAY_TIMEOUT_MS),

  stop: (chatId: number | string, close = false) =>
    request<any>('POST', '/stop', { chatId: String(chatId), close }),
  status: (chatId?: number | string) =>
    request<any>(
      'GET',
      chatId === undefined ? '/status' : `/status?chatId=${encodeURIComponent(String(chatId))}`,
      undefined,
      SHORT_TIMEOUT_MS
    ),
  streams: () => request<{ streams: VoiceStream[]; activeStreams: number }>('GET', '/streams', undefined, SHORT_TIMEOUT_MS),
  pause: (chatId: number | string) => request<any>('POST', '/pause', { chatId: String(chatId) }),
  resume: (chatId: number | string) => request<any>('POST', '/resume', { chatId: String(chatId) }),
  volume: (chatId: number | string, volume: number) =>
    request<any>('POST', '/volume', { chatId: String(chatId), volume }),
  mute: (chatId: number | string, muted: boolean) =>
    request<any>('POST', '/mute', { chatId: String(chatId), muted }),

  /** آیا همین حالا یک حساب آمادهٔ پخش هست؟ (برای انتخاب حالت پخش) */
  hasReadyAccount: async (): Promise<boolean> => {
    const health = await voiceApi.health();
    if (health.ok) return Number(health.data?.ready ?? 0) > 0;
    const accounts = await voiceApi.listAccounts();
    if (!accounts.ok) return false;
    return (accounts.data?.accounts ?? []).some((account) => account.status === 'ready' && account.hasSession);
  },
};

export function voiceBaseUrl(): string {
  return VOICE_URL;
}
