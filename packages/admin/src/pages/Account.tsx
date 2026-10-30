import { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { UserCog, KeyRound, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';

interface AccountInfo {
  id: number;
  username: string;
  email: string | null;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-white">
          {icon}
        </div>
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function Account() {
  const { updateSession } = useAuth();
  const [account, setAccount] = useState<AccountInfo | null>(null);

  const [username, setUsername] = useState('');
  const [usernamePassword, setUsernamePassword] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadAccount();
  }, []);

  const loadAccount = async () => {
    try {
      const res = await axios.get('/api/account');
      setAccount(res.data);
      setUsername(res.data.username);
    } catch {
      setError('خطا در بارگذاری اطلاعات حساب');
    }
  };

  const flash = (text: string) => {
    setMessage(text);
    setError('');
    setTimeout(() => setMessage(''), 4000);
  };

  const changeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await axios.put('/api/account/username', { username, password: usernamePassword });
      updateSession(res.data.token, res.data.admin);
      setAccount((prev) => (prev ? { ...prev, username: res.data.admin.username } : prev));
      setUsernamePassword('');
      flash('نام کاربری با موفقیت تغییر کرد');
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در تغییر نام کاربری');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== repeatPassword) {
      setError('تکرار رمز عبور جدید مطابقت ندارد');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      await axios.put('/api/account/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      flash('رمز عبور با موفقیت تغییر کرد');
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در تغییر رمز عبور');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-slate-700 to-slate-900 rounded-xl flex items-center justify-center shadow-lg">
            <UserCog size={24} className="text-white" />
          </div>
          حساب کاربری
        </h1>
        <p className="text-gray-500 mt-2">مدیریت نام کاربری و رمز عبور پنل مدیریت</p>
      </div>

      {message && (
        <div className="card bg-green-50 border-green-200 flex items-center gap-3">
          <CheckCircle size={20} className="text-green-600" />
          <p className="text-green-700 text-sm">{message}</p>
        </div>
      )}

      {error && (
        <div className="card bg-red-50 border-red-200 flex items-center gap-3">
          <AlertCircle size={20} className="text-red-600" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <div className="card bg-slate-50">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-3 text-sm">
          <span className="text-gray-500">
            نام کاربری فعلی: <span className="font-bold text-gray-900">{account?.username ?? '—'}</span>
          </span>
          <span className="text-gray-500 flex items-center gap-1">
            <ShieldCheck size={16} className="text-indigo-500" />
            نقش: <span className="font-bold text-gray-900">{account?.role ?? '—'}</span>
          </span>
          <span className="text-gray-500">
            آخرین ورود: <span className="text-gray-900">
              {account?.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('fa-IR') : '—'}
            </span>
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="تغییر نام کاربری" icon={<UserCog size={18} />}>
          <form onSubmit={changeUsername} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">نام کاربری جدید</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-field font-mono"
                dir="ltr"
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9._-]{3,32}"
                title="۳ تا ۳۲ نویسه: حروف انگلیسی، عدد، نقطه، خط تیره، زیرخط"
                required
              />
              <p className="text-xs text-gray-400 mt-2 leading-5">
                فقط حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط؛ بین ۳ تا ۳۲ نویسه.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">رمز عبور فعلی</label>
              <input
                type="password"
                value={usernamePassword}
                onChange={(e) => setUsernamePassword(e.target.value)}
                className="input-field font-mono"
                dir="ltr"
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
              ذخیره نام کاربری
            </button>
          </form>
        </SectionCard>

        <SectionCard title="تغییر رمز عبور" icon={<KeyRound size={18} />}>
          <form onSubmit={changePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">رمز عبور فعلی</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input-field font-mono"
                dir="ltr"
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">رمز عبور جدید</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input-field font-mono"
                dir="ltr"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <p className="text-xs text-gray-400 mt-2">حداقل ۸ نویسه.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">تکرار رمز عبور جدید</label>
              <input
                type="password"
                value={repeatPassword}
                onChange={(e) => setRepeatPassword(e.target.value)}
                className="input-field font-mono"
                dir="ltr"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <button type="submit" disabled={saving} className="btn-success disabled:opacity-50">
              تغییر رمز عبور
            </button>
          </form>
        </SectionCard>
      </div>
    </div>
  );
}
