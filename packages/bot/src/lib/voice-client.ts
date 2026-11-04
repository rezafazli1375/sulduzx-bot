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

const DEFAULT_TIMEOUT_MS = 12_000;
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
  startedAt?: number;
  endedAt?: number;
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

export const voiceApi = {
  url: VOICE_URL,

  health: () => request<any>('GET', '/health', undefined, 5_000),

  getConfig: () => request<any>('GET', '/config'),
  setConfig: (apiId: string, apiHash: string) => request<any>('POST', '/config', { apiId, apiHash }),
  clearConfig: () => request<any>('DELETE', '/config'),

  loginStart: (phone: string, label?: string) => request<any>('POST', '/login/start', { phone, label }),
  loginConfirm: (token: string, code?: string, password?: string) =>
    request<any>('POST', '/login/confirm', { token, code, password }),
  loginCancel: (token: string) => request<any>('POST', '/login/cancel', { token }),

  listAccounts: () => request<{ accounts: VoiceAccount[]; activeStreams: number; streams: VoiceStream[] }>(
    'GET',
    '/accounts'
  ),
  connectAccount: (id: string) => request<any>('POST', '/accounts/connect', { id }),
  logoutAccount: (id: string) => request<any>('POST', '/accounts/logout', { id }),
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
    request<any>('GET', chatId === undefined ? '/status' : `/status?chatId=${encodeURIComponent(String(chatId))}`, undefined, 6_000),
  volume: (chatId: number | string, volume: number) =>
    request<any>('POST', '/volume', { chatId: String(chatId), volume }),

  /** آیا همین حالا یک حساب آمادهٔ پخش هست؟ (برای انتخاب حالت پخش) */
  hasReadyAccount: async (): Promise<boolean> => {
    const result = await voiceApi.listAccounts();
    if (!result.ok) return false;
    const accounts = result.data?.accounts ?? [];
    return accounts.some((account) => account.status === 'ready' && account.hasSession);
  },
};

export function voiceBaseUrl(): string {
  return VOICE_URL;
}
