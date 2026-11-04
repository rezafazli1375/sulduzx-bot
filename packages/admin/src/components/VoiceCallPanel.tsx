import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  AlertCircle,
  CheckCircle,
  Headphones,
  KeyRound,
  Loader2,
  Phone,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
  LogOut,
  Link2,
  X,
} from 'lucide-react';

/**
 * بخش «پخش در ویس‌کال» در صفحهٔ موزیک.
 *
 * همه‌چیز از API ربات و از طریق سرویس داخلی sulduz-voice انجام می‌شود. کلید
 * API و سشن حساب فقط داخل آن سرویس و روی ./data/voice می‌مانند؛ اینجا هیچ‌وقت
 * مقدار کامل نمایش داده نمی‌شود (شناسهٔ API ماسک‌شده است و شمارهٔ حساب هم
 * ماسک‌شده). به همین دلیل اینجا فقط وارد کردن، وارد شدن و پخش امکان‌پذیر است.
 */

const MODE_LABEL: Record<string, string> = {
  default: 'پیش‌فرض تنظیمات',
  chat: 'پیام صوتی در چت',
  voice: 'ویس‌کال گروه',
};

const STATUS_LABEL: Record<string, string> = {
  ready: 'آماده',
  connected: 'متصل',
  'needs-login': 'نیاز به ورود',
  error: 'خطا',
  'logged-out': 'خارج شده',
};

function elapsedLabel(startedAt?: number): string {
  if (!startedAt) return '—';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - Number(startedAt)));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s} ثانیه`;
}

function StatusChip({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span
      className={`text-xs rounded-lg px-2.5 py-1 border flex items-center gap-1.5 ${
        ok
          ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-red-50 border-red-200 text-red-700'
      }`}
    >
      {ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
      {ok ? yes : no}
    </span>
  );
}

export default function VoiceCallPanel({
  tracks,
  onNotice,
}: {
  tracks: any[];
  onNotice: (message: string) => void;
}) {
  const [info, setInfo] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // کلید API
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');

  // ورود سه مرحله‌ای
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [login, setLogin] = useState<any>(null); // { token, codeType, sentInsideTelegram, needsPassword }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  // پخش آزمایشی
  const [testChat, setTestChat] = useState('');
  const [testTrack, setTestTrack] = useState('');

  const load = useCallback(async () => {
    try {
      const [voiceRes, groupsRes] = await Promise.all([
        axios.get('/api/voice'),
        axios.get('/api/music/groups'),
      ]);
      setInfo(voiceRes.data);
      setGroups(groupsRes.data.groups ?? []);
      if (!testChat) {
        const first = (groupsRes.data.groups ?? [])[0];
        if (first) setTestChat(first.chatId);
      }
      setError('');
    } catch (err: any) {
      console.error('Load voice panel error:', err);
      setError(err.response?.data?.error || 'خطا در دریافت وضعیت ویس‌کال');
    } finally {
      setLoading(false);
    }
  }, [testChat]);

  useEffect(() => {
    load();
  }, [load]);

  // وضعیت زنده (پخش‌های فعال و اتصال حساب‌ها) هر ۲۰ ثانیه تازه می‌شود
  useEffect(() => {
    const timer = setInterval(() => {
      axios
        .get('/api/voice')
        .then((res) => setInfo(res.data))
        .catch(() => undefined);
    }, 20_000);
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
      if (!window.confirm('کلید API پاک شود؟ برای ورود دوبارهٔ حساب‌ها باید دوباره وارد شوند.')) {
        return;
      }
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
      onNotice(
        res.data?.sentInsideTelegram
          ? '📩 کد در تلگرامِ همان شماره ارسال شد'
          : '📩 کد با پیامک ارسال شد'
      );
      await load();
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
      if (kind === 'connect') await axios.post('/api/voice/accounts/connect', { id: account.id });
      if (kind === 'logout') await axios.post('/api/voice/accounts/logout', { id: account.id });
      if (kind === 'delete') {
        if (
          !window.confirm(
            `حساب ${account.phone} حذف شود؟ برای استفادهٔ دوباره باید دوباره وارد تلگرام شوید.`
          )
        )
          return;
      }
      if (kind === 'delete') await axios.delete(`/api/voice/accounts/${account.id}`);
      onNotice(
        kind === 'connect' ? '🔌 حساب دوباره متصل شد' : kind === 'logout' ? '🚪 از حساب خارج شد' : '🗑 حساب حذف شد'
      );
      await load();
    });

  const setMode = (group: any, mode: string) =>
    run(`mode:${group.id}`, async () => {
      await axios.patch(`/api/music/groups/${group.id}`, { mode });
      onNotice(
        mode === 'voice'
          ? '🎧 پخش این گروه روی ویس‌کال تنظیم شد'
          : mode === 'chat'
            ? '💬 پخش این گروه روی پیام چت تنظیم شد'
            : '♻️ این گروه از تنظیم سراسری پیروی می‌کند'
      );
      await load();
    });

  const testPlay = () =>
    run('testPlay', async () => {
      if (!testChat || !testTrack) {
        setError('گروه و آهنگ را انتخاب کنید');
        return;
      }
      await axios.post('/api/voice/play', { chatId: testChat, trackId: parseInt(testTrack, 10) });
      onNotice('🎧 پخش در ویس‌کال گروه شروع شد');
      await load();
    });

  const testStop = () =>
    run('testStop', async () => {
      if (!testChat) {
        setError('گروه را انتخاب کنید');
        return;
      }
      await axios.post('/api/voice/stop', { chatId: testChat });
      onNotice('⏹ پخش ویس‌کال متوقف شد');
      await load();
    });

  const service = info?.service ?? {};
  const accounts: any[] = info?.accounts ?? [];
  const streams: any[] = info?.streams ?? [];
  const playable = tracks.filter((track) => track.hasLocalFile);

  return (
    <div className="card space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Headphones size={20} className="text-teal-600" />
            پخش در ویس‌کال گروه
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            برای اینکه آهنگ داخل ویس‌کال پخش شود، یک حساب تلگرام عادی باید وارد شود. ربات فقط
            دستور‌ها را اجرا می‌کند و صدا از این حساب می‌رود.
          </p>
        </div>
        <button
          onClick={load}
          className="btn-secondary flex items-center gap-2 self-start"
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          بروزرسانی
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <StatusChip ok={Boolean(service.available)} yes="سرویس ویس‌کال فعال است" no="سرویس ویس‌کال در دسترس نیست" />
        <StatusChip ok={Boolean(service.ffmpeg)} yes="ffmpeg آماده است" no="ffmpeg در سرویس نیست" />
        <StatusChip
          ok={Boolean(service.hasApiKeys)}
          yes={`کلید API تنظیم شده (${service.apiIdMasked ?? '—'})`}
          no="کلید API وارد نشده"
        />
        <StatusChip
          ok={accounts.some((account) => account.hasSession)}
          yes={`${accounts.length} حساب ذخیره شده`}
          no="هنوز حسابی وارد نشده"
        />
        <StatusChip
          ok={Boolean(info?.enabled)}
          yes="قابلیت در تنظیمات روشن است"
          no="قابلیت در تنظیمات خاموش است"
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
        <p className="text-xs text-gray-500 mb-3">
          از <b dir="ltr">my.telegram.org</b> (api_id و api_hash یک اپلیکیشن). این مقدارها در
          دیتابیس و فایل <b dir="ltr">.env</b> ذخیره نمی‌شوند؛ فقط داخل پوشهٔ{' '}
          <code dir="ltr">data/voice</code> با دسترسی ۰۶۰۰ می‌مانند.
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
            <button
              onClick={clearKeys}
              disabled={busy === 'clearKeys'}
              className="btn-secondary flex items-center gap-2 text-red-600 disabled:opacity-50"
            >
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
          وارد کردن حساب تلگرام
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          شماره‌ای که عضو ویس‌کال گروه‌های شماست. بعد از وارد شدن، ربات همچون یک کاربر عادی داخل
          ویس‌کال صدا می‌فرستد.
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
                placeholder="برچسب (مثلاً: حساب موزیک)"
                dir="rtl"
              />
            </div>
            <button
              onClick={startLogin}
              disabled={busy === 'loginStart' || !phone.trim()}
              className="btn-primary flex items-center gap-2 mt-3 disabled:opacity-50"
            >
              {busy === 'loginStart' ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />}
              ارسال کد ورود
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-sm text-teal-800">
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
              <button
                onClick={cancelLogin}
                disabled={busy === 'loginCancel'}
                className="btn-secondary disabled:opacity-50"
              >
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
                  <th className="text-right font-medium py-2">اتصال</th>
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
                      {account.lastError && (
                        <p className="text-xs text-red-600 mt-1">{account.lastError}</p>
                      )}
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
                    </td>
                    <td className="py-2.5 text-gray-700">
                      {account.connected ? '✅ متصل' : account.hasSession ? 'نشست ذخیره است' : '—'}
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
                          {busy === `delete:${account.id}` ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Trash2 size={16} />
                          )}
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

      {/* ─── پخش‌های فعال ─────────────────────── */}
      <div>
        <h3 className="font-bold text-gray-900 mb-2">
          پخش‌های فعال
          <span className="text-sm font-normal text-gray-500"> ({info?.activeStreams ?? 0})</span>
        </h3>
        {streams.length === 0 ? (
          <p className="text-sm text-gray-500">هم‌اکنون استریمی در ویس‌کال باز نیست.</p>
        ) : (
          <div className="space-y-2">
            {streams.map((stream) => (
              <div
                key={`${stream.accountId}-${stream.chatId}`}
                className="flex items-center gap-3 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 text-sm"
              >
                <Headphones size={16} className="text-teal-700 shrink-0" />
                <span className="font-bold text-gray-900 flex-1 truncate">{stream.title || '—'}</span>
                <span className="text-gray-600 text-xs" dir="ltr">
                  {groups.find((g) => String(g.chatId) === String(stream.chatId))?.title || stream.chatId}
                </span>
                <span className="text-xs text-gray-600">{elapsedLabel(stream.startedAt)}</span>
                <button
                  onClick={() =>
                    run(`stop:${stream.chatId}`, async () => {
                      await axios.post('/api/voice/stop', { chatId: stream.chatId });
                      onNotice('⏹ استریم بسته شد');
                      await load();
                    })
                  }
                  disabled={busy === `stop:${stream.chatId}`}
                  className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 disabled:opacity-50"
                >
                  <Square size={12} />
                  توقف
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── حالت پخش هر گروه ─────────────────── */}
      <div>
        <h3 className="font-bold text-gray-900 mb-1">محل پخش در گروه‌ها</h3>
        <p className="text-xs text-gray-500 mb-3">
          «ویس‌کال گروه» یعنی صدا داخل ویس‌کال پخش شود؛ اگر ویس‌کال بسته باشد یا حسابی وارد نشده
          باشد، ربات خودش همان آهنگ را در چت می‌فرستد و دلیلش را می‌گوید.
        </p>
        {groups.length === 0 ? (
          <p className="text-sm text-gray-500">
            گروهی در دیتابیس نیست. بعد از اینکه ربات در گروهی عضو باشد و دستوری زده شود، آن گروه
            این‌جا دیده می‌شود.
          </p>
        ) : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500 sticky top-0 bg-white">
                <tr>
                  <th className="text-right font-medium py-2">گروه</th>
                  <th className="text-right font-medium py-2">حالت پخش</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {groups.map((group) => (
                  <tr key={group.id}>
                    <td className="py-2">
                      <p className="font-bold text-gray-900">{group.title || 'گروه بی‌نام'}</p>
                      <p className="text-[11px] text-gray-400" dir="ltr">
                        {group.chatId}
                        {group.memberCount ? ` · ${group.memberCount} عضو` : ''}
                      </p>
                    </td>
                    <td className="py-2">
                      <select
                        value={group.musicMode ?? 'default'}
                        onChange={(e) => setMode(group, e.target.value)}
                        disabled={busy === `mode:${group.id}`}
                        className="input-field text-sm py-1 max-w-xs"
                      >
                        <option value="default">{MODE_LABEL.default}</option>
                        <option value="chat">{MODE_LABEL.chat}</option>
                        <option value="voice">{MODE_LABEL.voice}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── آزمایش ───────────────────────────── */}
      <div className="border border-gray-200 rounded-xl p-4">
        <h3 className="font-bold text-gray-900 mb-1">آزمایش پخش</h3>
        <p className="text-xs text-gray-500 mb-3">
          فقط آهنگ‌هایی که فایلشان روی سرور هست (آپلودی از پنل) در ویس‌کال قابل پخش‌اند.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            value={testChat}
            onChange={(e) => setTestChat(e.target.value)}
            className="input-field"
          >
            <option value="">انتخاب گروه…</option>
            {groups.map((group) => (
              <option key={group.id} value={group.chatId}>
                {group.title || group.chatId}
              </option>
            ))}
          </select>
          <select
            value={testTrack}
            onChange={(e) => setTestTrack(e.target.value)}
            className="input-field"
          >
            <option value="">انتخاب آهنگ…</option>
            {playable.map((track) => (
              <option key={track.id} value={track.id}>
                {track.title}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={testPlay}
            disabled={busy === 'testPlay' || !testChat || !testTrack}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {busy === 'testPlay' ? <Loader2 size={16} className="animate-spin" /> : <Headphones size={16} />}
            پخش در ویس‌کال
          </button>
          <button
            onClick={testStop}
            disabled={busy === 'testStop' || !testChat}
            className="btn-secondary flex items-center gap-2 disabled:opacity-50"
          >
            <Square size={14} />
            توقف
          </button>
          {playable.length === 0 && (
            <span className="text-xs text-amber-600 self-center">
              هنوز آهنگی با فایل روی سرور در کتابخانه نیست.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
