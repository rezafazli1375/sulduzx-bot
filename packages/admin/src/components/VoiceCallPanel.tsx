import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  AlertCircle,
  CheckCircle,
  KeyRound,
  Loader2,
  LogOut,
  Phone,
  Radio,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Square,
  Link2,
  Trash2,
  X,
} from 'lucide-react';

/**
 * بخش «رادیوی ویس‌کال» در صفحهٔ موزیک.
 *
 * یک حساب تلگرام عادی (شمارهٔ مجازی) وارد سرویس داخلی sulduz-voice می‌شود و
 * ربات در گروه، همان‌جا ویس‌کال را باز و آهنگ‌ها را یکی‌بعدی پخش می‌کند.
 * کلید API و رشتهٔ سشن هیچ‌وقت از سرویس بیرون نمی‌آید؛ این‌جا فقط ماسک‌شده‌ها
 * نمایش داده می‌شود. کاری که این پنل می‌کند: وارد کردن کلید، ورود حساب،
 * انتخاب حساب رادیو، تنظیم سریع و خاموش/روشن کردن رادیوی هر گروه.
 */

const STATUS_LABEL: Record<string, string> = {
  ready: 'آمادهٔ پخش',
  connected: 'متصل',
  'needs-login': 'نیاز به ورود دوباره',
  error: 'خطا',
  'logged-out': 'خارج شده',
};

const QUALITY_OPTIONS = [
  { value: 'low', label: 'کم — مصرف کمتر' },
  { value: 'medium', label: 'متوسط' },
  { value: 'high', label: 'زیاد — پیش‌فرض' },
  { value: 'studio', label: 'استودیو — سنگین' },
];

function clockOf(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function StatusChip({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span
      className={`text-xs rounded-lg px-2.5 py-1 border flex items-center gap-1.5 ${
        ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
      }`}
    >
      {ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
      {ok ? yes : no}
    </span>
  );
}

export default function VoiceCallPanel({
  groups,
  onNotice,
}: {
  groups: any[];
  onNotice: (message: string) => void;
}) {
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // کلید API
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');

  // ورود سه مرحله‌ای حساب
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [login, setLogin] = useState<any>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  // کنترل از پنل
  const [target, setTarget] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await axios.get('/api/voice');
      setInfo(res.data);
      setError('');
    } catch (err: any) {
      console.error('Load voice radio panel error:', err);
      setError(err.response?.data?.error || 'خطا در دریافت وضعیت رادیوی ویس‌کال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // فهرست پخش‌های زنده هر ۱۵ ثانیه تازه می‌شود
  useEffect(() => {
    const timer = setInterval(() => {
      axios
        .get('/api/voice')
        .then((res) => setInfo(res.data))
        .catch(() => undefined);
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await action();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'عملیات ناموفق بود');
    } finally {
      setBusy('');
    }
  };

  const saveKeys = () =>
    run('keys', async () => {
      await axios.post('/api/voice/config', { apiId: apiId.trim(), apiHash: apiHash.trim() });
      setApiHash('');
      onNotice('✅ کلید API در سرویس ویس‌کال ذخیره شد');
      await load();
    });

  const clearKeys = () =>
    run('clearKeys', async () => {
      if (!window.confirm('کلید API پاک شود؟ برای ورود دوبارهٔ حساب‌ها باید کلیدها را دوباره وارد کنید.')) return;
      await axios.delete('/api/voice/config');
      onNotice('🗑 کلید API پاک شد');
      await load();
    });

  const startLogin = () =>
    run('loginStart', async () => {
      const res = await axios.post('/api/voice/login/start', { phone: phone.trim(), label: label.trim() });
      setLogin(res.data);
      setCode('');
      setPassword('');
      onNotice(res.data?.sentInsideTelegram ? '📩 کد در تلگرامِ همان شماره نمایش داده شد' : '📩 کد با پیامک ارسال شد');
    });

  const confirmLogin = () =>
    run('loginConfirm', async () => {
      const res = await axios.post('/api/voice/login/confirm', {
        token: login?.token,
        code: code.trim() || undefined,
        password: password.trim() || undefined,
      });
      if (res.data?.needsPassword) {
        setLogin({ ...login, needsPassword: true });
        onNotice('🔐 این حساب رمز دو مرحله‌ای دارد؛ رمز را وارد کنید');
        return;
      }
      setLogin(null);
      setCode('');
      setPassword('');
      setPhone('');
      setLabel('');
      onNotice(`✅ حساب ${res.data?.account?.phone ?? ''} وارد شد`);
      await load();
    });

  const cancelLogin = () =>
    run('loginCancel', async () => {
      if (login?.token) await axios.post('/api/voice/login/cancel', { token: login.token });
      setLogin(null);
      setCode('');
      setPassword('');
      await load();
    });

  const accountAction = (kind: 'connect' | 'logout' | 'delete', account: any) =>
    run(`${kind}:${account.id}`, async () => {
      if (kind === 'logout' && !window.confirm(`از حساب ${account.phone} خارج شوی؟ رادیوی گروه‌های روشن در دور بعدی خاموش می‌شود.`)) {
        return;
      }
      if (kind === 'delete' && !window.confirm(`حساب ${account.phone} حذف شود؟ برای استفادهٔ دوباره باید دوباره وارد تلگرام شوید.`)) {
        return;
      }
      if (kind === 'connect') await axios.post('/api/voice/accounts/connect', { id: account.id });
      if (kind === 'logout') await axios.post('/api/voice/accounts/logout', { id: account.id });
      if (kind === 'delete') await axios.delete(`/api/voice/accounts/${account.id}`);
      onNotice(kind === 'connect' ? '🔌 حساب دوباره متصل شد' : kind === 'logout' ? '🚪 از حساب خارج شد' : '🗑 حساب حذف شد');
      await load();
    });

  const pickAccount = (account: any) =>
    run(`pick:${account.id}`, async () => {
      await axios.post('/api/voice/options', { accountId: String(account.id) });
      onNotice(`📻 پخش رادیو با حساب ${account.phone}`);
      await load();
    });

  const saveOptions = (patch: Record<string, any>, message: string) =>
    run('options', async () => {
      await axios.post('/api/voice/options', patch);
      onNotice(message);
      await load();
    });

  const radioStart = () =>
    run('radioStart', async () => {
      if (!target) {
        setError('گروه را انتخاب کنید');
        return;
      }
      const group = groups.find((item) => String(item.chatId) === String(target));
      const res = await axios.post('/api/voice/radio/start', {
        chatId: target,
        botId: group?.botId,
        startedBy: 'پنل',
      });
      onNotice(res.data?.already ? `ℹ️ ${res.data.message || 'رادیو همین حالا روشن است'}` : '📻 رادیو در آن گروه روشن شد');
      await load();
    });

  const radioNext = (chatId: number) =>
    run(`next:${chatId}`, async () => {
      await axios.post('/api/voice/radio/next', { chatId });
      onNotice('⏭ آهنگ بعدی پخش شد');
      await load();
    });

  const radioStop = (chatId: number) =>
    run(`stop:${chatId}`, async () => {
      await axios.post('/api/voice/radio/stop', { chatId });
      onNotice('⏹ رادیوی آن گروه خاموش شد');
      await load();
    });

  const radioStopAll = () =>
    run('stopAll', async () => {
      if (!window.confirm('رادیوی همهٔ گروه‌ها خاموش شود؟')) return;
      const res = await axios.post('/api/voice/radio/stop', {});
      onNotice(`⏹ ${res.data?.stopped ?? 0} گروه خاموش شد`);
      await load();
    });

  const service = info?.service ?? {};
  const options = info?.options ?? {};
  const accounts: any[] = info?.accounts ?? [];
  const radio: any[] = info?.radio ?? [];
  const readyAccounts = accounts.filter((account) => account.status === 'ready');

  return (
    <div className="card space-y-5" id="music-voice-radio">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Radio size={20} className="text-teal-600" />
            رادیوی ویس‌کال گروه
          </h2>
          <p className="text-sm text-gray-500 mt-1 leading-6">
            کاربر در گروه{' '}
            <code dir="ltr" className="bg-gray-100 px-1 rounded">
              /voicecall
            </code>{' '}
            را می‌زند؛ یک حساب تلگرام عادی (شمارهٔ مجازی) وارد ویس‌کال گروه می‌شود و آهنگ‌ها را یکی‌بعدی
            تصادفی پخش می‌کند. دکمهٔ ⏹ روی کارت گروه برای همهٔ اعضا رادیو را خاموش می‌کند.
          </p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2 self-start" disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          بروزرسانی
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <StatusChip ok={Boolean(service.available)} yes="سرویس ویس‌کال پاسخ می‌دهد" no="سرویس ویس‌کال در دسترس نیست" />
        <StatusChip ok={Boolean(service.ffmpeg)} yes="ffmpeg آماده است" no="ffmpeg در سرویس نیست" />
        <StatusChip
          ok={Boolean(service.hasApiKeys)}
          yes={`کلید API تنظیم شده (${service.apiIdMasked ?? '—'})`}
          no="کلید API وارد نشده"
        />
        <StatusChip
          ok={readyAccounts.length > 0}
          yes={`${readyAccounts.length} حساب آمادهٔ پخش`}
          no="حسابی وارد نشده است"
        />
        <StatusChip ok={Boolean(info?.enabled)} yes="بخش در تنظیمات روشن است" no="بخش در تنظیمات خاموش است" />
        <StatusChip
          ok={radio.length > 0}
          yes={`${radio.length} گروه روشن`}
          no="همهٔ گروه‌ها خاموش‌اند"
        />
      </div>

      {!service.available && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>
            {service.error || 'سرویس sulduz-voice بالا نیست.'} اگر تازه نصب کرده‌اید، با{' '}
            <code dir="ltr">docker compose up -d voice</code> آن را اجرا کنید.
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ─── کلید API ─────────────────────────── */}
      <div className="border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-1">
          <KeyRound size={18} className="text-teal-600" />
          کلید API تلگرام
        </h3>
        <p className="text-xs text-gray-500 mb-3 leading-6">
          از <b dir="ltr">my.telegram.org</b> (api_id و api_hash یک اپلیکیشن). این مقدارها در دیتابیس و
          فایل <b dir="ltr">.env</b> ذخیره نمی‌شوند؛ فقط داخل پوشهٔ{' '}
          <code dir="ltr">data/voice</code> با دسترسی ۰۶۰۰ روی سرور می‌مانند.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            value={apiId}
            onChange={(e) => setApiId(e.target.value.replace(/[^0-9]/g, ''))}
            className="input-field"
            placeholder="API_ID"
            dir="ltr"
            inputMode="numeric"
          />
          <input
            value={apiHash}
            onChange={(e) => setApiHash(e.target.value.trim())}
            className="input-field"
            placeholder="API_HASH"
            dir="ltr"
            type="password"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={saveKeys}
            disabled={busy === 'keys' || !apiId.trim() || apiHash.trim().length < 32}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {busy === 'keys' ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            ذخیرهٔ کلیدها
          </button>
          {service.hasApiKeys && (
            <button onClick={clearKeys} disabled={busy === 'clearKeys'} className="btn-secondary flex items-center gap-2 text-red-600 disabled:opacity-50">
              <Trash2 size={16} />
              پاک کردن کلیدها
            </button>
          )}
        </div>
      </div>

      {/* ─── ورود حساب ────────────────────────── */}
      <div className="border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-1">
          <Phone size={18} className="text-teal-600" />
          وارد کردن شمارهٔ مجازی
        </h3>
        <p className="text-xs text-gray-500 mb-3 leading-6">
          شماره‌ای که آن را با تلگرام ثبت‌نام کرده‌اید. بعد از وارد شدن، آن حساب مثل یک کاربر عادی به
          ویس‌کال گروه می‌رود و صدا از طرف او می‌رود. این حساب باید از قبل عضو گروه باشد.
        </p>

        {!login ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input-field"
                placeholder="+989121234567"
                dir="ltr"
              />
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="input-field"
                placeholder="برچسب (مثلاً: حساب رادیو)"
                dir="rtl"
              />
            </div>
            <button
              onClick={startLogin}
              disabled={busy === 'loginStart' || !phone.trim() || !service.hasApiKeys}
              className="btn-primary flex items-center gap-2 mt-3 disabled:opacity-50"
            >
              {busy === 'loginStart' ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />}
              ارسال کد ورود
            </button>
            {!service.hasApiKeys && (
              <span className="text-xs text-amber-600 mr-3 self-center">اول کلید API را ذخیره کنید.</span>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-sm text-teal-800 leading-6">
              {login.sentInsideTelegram
                ? `کد ورود در تلگرامِ ${login.phone} نمایش داده شد.`
                : `کد ورود برای ${login.phone} پیامک شد.`}{' '}
              تا ۱۵ دقیقه وقت دارید.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9a-zA-Z]/g, ''))}
                className="input-field"
                placeholder="کد ۵ تا ۸ رقمی"
                dir="ltr"
              />
              {login.needsPassword && (
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field"
                  placeholder="رمز دو مرحله‌ای"
                  dir="ltr"
                  type="password"
                  autoComplete="off"
                />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={confirmLogin}
                disabled={busy === 'loginConfirm' || (!code.trim() && !password.trim())}
                className="btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {busy === 'loginConfirm' ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {login.needsPassword && !code.trim() ? 'تأیید رمز' : 'تأیید و ورود'}
              </button>
              <button onClick={cancelLogin} disabled={busy === 'loginCancel'} className="btn-secondary disabled:opacity-50">
                لغو
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── حساب‌ها ──────────────────────────── */}
      <div>
        <h3 className="font-bold text-gray-900 mb-2">حساب‌های ذخیره‌شده</h3>
        {accounts.length === 0 ? (
          <p className="text-sm text-gray-500">هنوز حسابی وارد نشده است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="text-right font-medium py-2">حساب</th>
                  <th className="text-right font-medium py-2">وضعیت</th>
                  <th className="text-right font-medium py-2">رادیو</th>
                  <th className="text-right font-medium py-2">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="py-2.5">
                      <p className="font-bold text-gray-900" dir="ltr">
                        {account.phone}
                      </p>
                      <p className="text-xs text-gray-500">
                        {[account.label, account.firstName, account.username ? `@${account.username}` : null]
                          .filter(Boolean)
                          .join(' · ') || 'بدون برچسب'}
                        {account.dcId ? ` · DC${account.dcId}` : ''}
                        {account.premium ? ' · پرمیوم' : ''}
                      </p>
                      {account.lastError && <p className="text-xs text-red-600 mt-1">{account.lastError}</p>}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`text-xs rounded px-2 py-0.5 border ${
                          account.status === 'ready'
                            ? 'bg-green-50 border-green-200 text-green-700'
                            : 'bg-gray-100 border-gray-200 text-gray-600'
                        }`}
                      >
                        {STATUS_LABEL[account.status ?? ''] ?? account.status ?? '—'}
                      </span>
                      <span className="block text-[11px] text-gray-400 mt-1">
                        {account.connected ? 'اتصال برقرار' : account.hasSession ? 'نشست ذخیره است' : 'بدون نشست'}
                      </span>
                    </td>
                    <td className="py-2.5">
                      {String(options.accountId || '') === String(account.id) ? (
                        <span className="text-xs rounded-lg px-2 py-1 border bg-teal-50 border-teal-200 text-teal-700 flex items-center gap-1 w-fit">
                          <Radio size={13} /> با این حساب پخش می‌شود
                        </span>
                      ) : (
                        <button
                          onClick={() => pickAccount(account)}
                          disabled={busy === `pick:${account.id}` || account.status !== 'ready'}
                          className="btn-secondary text-xs py-1 px-2 disabled:opacity-40"
                          title="پخش رادیو با این حساب انجام شود"
                        >
                          انتخاب برای رادیو
                        </button>
                      )}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => accountAction('connect', account)}
                          disabled={busy === `connect:${account.id}` || !account.hasSession}
                          className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 disabled:opacity-40"
                          title="اتصال دوباره"
                        >
                          <Link2 size={14} />
                          اتصال
                        </button>
                        <button
                          onClick={() => accountAction('logout', account)}
                          disabled={busy === `logout:${account.id}` || !account.hasSession}
                          className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 disabled:opacity-40"
                          title="خروج از حساب تلگرام"
                        >
                          <LogOut size={14} />
                          خروج
                        </button>
                        <button
                          onClick={() => accountAction('delete', account)}
                          disabled={busy === `delete:${account.id}`}
                          className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
                          title="حذف حساب"
                        >
                          {busy === `delete:${account.id}` ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── تنظیم سریع ───────────────────────── */}
      <div className="border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-900 mb-1">تنظیم رادیو</h3>
        <p className="text-xs text-gray-500 mb-3 leading-6">
          همین مقادیر در بخش تنظیمات («رادیو در ویس‌کال») هم هستند و بلافاصله روی پخش‌های روشن اثر
          می‌گذارند.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">کیفیت صوتی</label>
            <select
              value={options.quality || 'high'}
              onChange={(e) => saveOptions({ quality: e.target.value }, '🎚 کیفیت صوتی عوض شد')}
              className="input-field text-sm"
            >
              {QUALITY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">صدا (۱ تا ۲۰۰)</label>
            <input
              type="number"
              min={1}
              max={200}
              defaultValue={options.volume ?? 100}
              onBlur={(e) => {
                const value = Math.round(Number(e.target.value));
                if (Number.isFinite(value) && value !== Number(options.volume)) {
                  saveOptions({ volume: value }, '🔊 صدا ذخیره شد');
                }
              }}
              className="input-field text-sm"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">سقف هر نشست (دقیقه، ۰ = بی‌سقف)</label>
            <input
              type="number"
              min={0}
              max={1440}
              defaultValue={options.maxMinutes ?? 120}
              onBlur={(e) => {
                const value = Math.round(Number(e.target.value));
                if (Number.isFinite(value) && value !== Number(options.maxMinutes)) {
                  saveOptions({ maxMinutes: value }, '⏱ سقف زمان ذخیره شد');
                }
              }}
              className="input-field text-sm"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">حداکثر گروه هم‌زمان</label>
            <input
              type="number"
              min={1}
              max={20}
              defaultValue={options.maxStreams ?? 5}
              onBlur={(e) => {
                const value = Math.round(Number(e.target.value));
                if (Number.isFinite(value) && value !== Number(options.maxStreams)) {
                  saveOptions({ maxStreams: value }, '👥 سقف پخش هم‌زمان ذخیره شد');
                }
              }}
              className="input-field text-sm"
              dir="ltr"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-4">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(info?.enabled)}
              onChange={(e) => saveOptions({ enabled: e.target.checked }, e.target.checked ? '📻 رادیو روشن شد' : '📻 رادیو خاموش شد')}
              className="w-4 h-4 rounded border-gray-300"
            />
            فعال بودن بخش رادیو
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(options.autoStart)}
              onChange={(e) =>
                saveOptions({ autoStart: e.target.checked }, e.target.checked ? '▶️ ویس‌کال خودش باز می‌شود' : '⏸ ویس‌کال باید باز باشد')
              }
              className="w-4 h-4 rounded border-gray-300"
            />
            باز کردن ویس‌کال اگر بسته بود
          </label>
          {busy === 'options' && <Loader2 size={16} className="animate-spin text-gray-400" />}
        </div>
      </div>

      {/* ─── رادیوهای روشن ────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-gray-900">
            گروه‌های روشن <span className="text-sm font-normal text-gray-500">({radio.length})</span>
          </h3>
          {radio.length > 0 && (
            <button
              onClick={radioStopAll}
              disabled={busy === 'stopAll'}
              className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 text-red-600 disabled:opacity-50"
            >
              <Square size={12} />
              توقف همه
            </button>
          )}
        </div>
        {radio.length === 0 ? (
          <p className="text-sm text-gray-500">هم‌اکنون رادیویی در هیچ گروهی روشن نیست.</p>
        ) : (
          <div className="space-y-2">
            {radio.map((item) => (
              <div
                key={item.chatId}
                className="flex flex-wrap items-center gap-3 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 text-sm"
              >
                <Radio size={16} className="text-teal-700 shrink-0" />
                <span className="font-bold text-gray-900 flex-1 truncate">{item.title || String(item.chatId)}</span>
                <span className="text-xs text-gray-600 truncate max-w-[240px]">🎵 {item.track || '—'}</span>
                <span className="text-xs text-gray-600" dir="ltr">
                  {clockOf(item.elapsedSec)}
                  {item.durationSec ? ` / ${clockOf(item.durationSec)}` : ''} · آهنگ {item.plays}
                </span>
                <span className="text-[11px] text-gray-500">شروع: {item.startedBy}</span>
                {item.lastError && <span className="text-[11px] text-red-600">⚠️ {item.lastError}</span>}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => radioNext(item.chatId)}
                    disabled={busy === `next:${item.chatId}`}
                    className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 disabled:opacity-50"
                    title="آهنگ بعدی"
                  >
                    <SkipForward size={12} />
                    بعدی
                  </button>
                  <button
                    onClick={() => radioStop(item.chatId)}
                    disabled={busy === `stop:${item.chatId}`}
                    className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 text-red-600 disabled:opacity-50"
                    title="توقف رادیوی این گروه"
                  >
                    <Square size={12} />
                    توقف
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── روشن کردن از پنل ─────────────────── */}
      <div className="border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-900 mb-1">آزمایش از پنل</h3>
        <p className="text-xs text-gray-500 mb-3 leading-6">
          رادیو در همان گروه روشن می‌شود و آهنگ‌ها به‌شکل تصادفی از کتابخانهٔ موزیک انتخاب می‌شوند. اگر
          ربات در گروه کارت نفرستد، از خود گروه{' '}
          <code dir="ltr">/voicecall</code> را بزنید.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="input-field max-w-sm">
            <option value="">انتخاب گروه…</option>
            {groups.map((group) => (
              <option key={group.id} value={group.chatId}>
                {group.title || group.chatId}
                {group.botName ? ` — ${group.botName}` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={radioStart}
            disabled={busy === 'radioStart' || !target || readyAccounts.length === 0}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {busy === 'radioStart' ? <Loader2 size={16} className="animate-spin" /> : <Radio size={16} />}
            روشن کردن رادیو
          </button>
          {readyAccounts.length === 0 && (
            <span className="text-xs text-amber-600">اول یک حساب تلگرام را وارد کنید.</span>
          )}
          {groups.length === 0 && <span className="text-xs text-gray-500">گروهی در دیتابیس ثبت نشده است.</span>}
        </div>
      </div>
    </div>
  );
}
