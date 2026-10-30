import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  DatabaseBackup,
  Download,
  Trash2,
  RotateCcw,
  Plus,
  Upload,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  HardDrive,
} from 'lucide-react';

interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

interface Stats {
  users: number;
  bots: number;
  channels: number;
  settings: number;
  tickets: number;
}

const CONFIRM_WORD = 'بازگردانی';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('fa-IR');
}

export default function Backup() {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [maxBackups, setMaxBackups] = useState(20);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [restoreTarget, setRestoreTarget] = useState<BackupFile | null>(null);
  const [uploaded, setUploaded] = useState<{ name: string; size: number; data: any } | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    try {
      const res = await axios.get('/api/backup');
      setBackups(res.data.backups);
      setStats(res.data.stats);
      setMaxBackups(res.data.maxBackups ?? 20);
    } catch {
      setError('خطا در بارگذاری اطلاعات بکاپ');
    }
  };

  const createBackup = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await axios.post('/api/backup');
      setMessage(`بکاپ «${res.data.name}» با موفقیت ساخته شد (${formatSize(res.data.size)})`);
      await loadBackups();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ساخت بکاپ');
    } finally {
      setLoading(false);
    }
  };

  const downloadBackup = async (backup: BackupFile) => {
    try {
      const res = await axios.get(`/api/backup/${backup.name}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = backup.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('خطا در دانلود بکاپ');
    }
  };

  const deleteBackup = async (backup: BackupFile) => {
    if (!window.confirm(`بکاپ «${backup.name}» حذف شود؟`)) return;
    try {
      await axios.delete(`/api/backup/${backup.name}`);
      setMessage('بکاپ حذف شد');
      await loadBackups();
    } catch {
      setError('خطا در حذف بکاپ');
    }
  };

  const pickFile = async (file: File | null) => {
    setError('');
    setMessage('');
    if (!file) {
      setUploaded(null);
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed?.format !== 'sulduz-backup') {
        setError('این فایل، بکاپ معتبر سولدوز نیست');
        setUploaded(null);
        return;
      }
      setUploaded({ name: file.name, size: file.size, data: parsed });
      setRestoreTarget(null);
      setConfirmText('');
    } catch {
      setError('فایل انتخاب‌شده JSON معتبر نیست');
      setUploaded(null);
    }
  };

  const startRestoreServer = (backup: BackupFile) => {
    setRestoreTarget(backup);
    setUploaded(null);
    setConfirmText('');
    setMessage('');
    setError('');
  };

  const cancelRestore = () => {
    setRestoreTarget(null);
    setUploaded(null);
    setConfirmText('');
  };

  const runRestore = async () => {
    const targetLabel = restoreTarget ? restoreTarget.name : uploaded?.name;
    if (confirmText.trim() !== CONFIRM_WORD) {
      setError(`برای تایید، کلمه «${CONFIRM_WORD}» را دقیقاً وارد کنید`);
      return;
    }

    setRestoring(true);
    setError('');
    setMessage('');
    try {
      const payload = restoreTarget ? { name: restoreTarget.name } : { data: uploaded!.data };
      const res = await axios.post('/api/backup/restore', payload);
      setMessage(
        `بازگردانی «${targetLabel}» انجام شد. بکاپ ایمنی قبل از بازگردانی: ${res.data.safetyBackup}${
          res.data.botsReloaded ? '' : ' — هشدار: ری‌لود ربات‌ها ناموفق بود، کانتینر ربات را ری‌استارت کنید.'
        }`
      );
      cancelRestore();
      await loadBackups();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در بازگردانی بکاپ');
    } finally {
      setRestoring(false);
    }
  };

  const pending = restoreTarget || uploaded;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <DatabaseBackup size={24} className="text-white" />
            </div>
            بکاپ و بازگردانی
          </h1>
          <p className="text-gray-500 mt-2">
            نسخه پشتیبان از داده‌های ربات بسازید، دانلود کنید یا بکاپ قبلی را بازگردانید
          </p>
        </div>
        <button
          onClick={createBackup}
          disabled={loading}
          className="btn-success flex items-center gap-2 disabled:opacity-50"
        >
          <Plus size={18} />
          {loading ? 'در حال ساخت...' : 'ساخت بکاپ جدید'}
        </button>
      </div>

      {message && (
        <div className="card bg-green-50 border-green-200 flex items-start gap-3">
          <CheckCircle size={20} className="text-green-600 mt-0.5 shrink-0" />
          <p className="text-green-700 text-sm leading-6">{message}</p>
        </div>
      )}

      {error && (
        <div className="card bg-red-50 border-red-200 flex items-start gap-3">
          <AlertCircle size={20} className="text-red-600 mt-0.5 shrink-0" />
          <p className="text-red-700 text-sm leading-6">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'کاربران', value: stats?.users },
          { label: 'ربات‌ها', value: stats?.bots },
          { label: 'کانال‌ها', value: stats?.channels },
          { label: 'تنظیمات', value: stats?.settings },
          { label: 'تیکت‌ها', value: stats?.tickets },
        ].map((item, index) => (
          <div
            key={item.label}
            className={`card flex items-center gap-3 ${
              index === 4 ? 'col-span-2 md:col-span-1' : ''
            }`}
          >
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <HardDrive size={18} />
            </div>
            <div>
              <p className="text-xs text-gray-500">{item.label}</p>
              <p className="text-xl font-bold text-gray-900">{item.value ?? '—'}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card bg-amber-50 border-amber-200">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-800 leading-6">
            <p className="font-bold mb-1">نکات مهم بازگردانی</p>
            <ul className="list-disc pr-5 space-y-1">
              <li>بازگردانی، داده‌های فعلی (کاربران، کانال‌ها، تیکت‌ها، تنظیمات، منو، متن‌ها و فروشگاه) را جایگزین می‌کند.</li>
              <li>حساب‌های کاربری پنل مدیریت در بکاپ نیستند و با بازگردانی تغییر نمی‌کنند.</li>
              <li>قبل از هر بازگردانی، به‌صورت خودکار یک بکاپ ایمنی (pre-restore) ساخته می‌شود.</li>
              <li>حداکثر {maxBackups} فایل بکاپ نگهداری می‌شود؛ قدیمی‌ترها خودکار حذف می‌شوند.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
            <DatabaseBackup size={18} className="text-white" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">بکاپ‌های موجود روی سرور</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-100">
                <th className="text-right py-3 font-medium">نام فایل</th>
                <th className="text-right py-3 font-medium">حجم</th>
                <th className="text-right py-3 font-medium">تاریخ</th>
                <th className="text-left py-3 font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {backups.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-10 text-gray-400">
                    هنوز بکاپی ساخته نشده است
                  </td>
                </tr>
              )}
              {backups.map((backup) => (
                <tr key={backup.name} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-3 font-mono text-xs text-gray-700" dir="ltr">
                    {backup.name}
                  </td>
                  <td className="py-3 text-gray-600">{formatSize(backup.size)}</td>
                  <td className="py-3 text-gray-600">{formatDate(backup.createdAt)}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => downloadBackup(backup)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="دانلود"
                      >
                        <Download size={17} />
                      </button>
                      <button
                        onClick={() => startRestoreServer(backup)}
                        className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg"
                        title="بازگردانی"
                      >
                        <RotateCcw size={17} />
                      </button>
                      <button
                        onClick={() => deleteBackup(backup)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        title="حذف"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
            <Upload size={18} className="text-white" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">بازگردانی از فایل آپلودی</h2>
        </div>

        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          className="block w-full max-w-md text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
        />

        {uploaded && (
          <p className="mt-3 text-sm text-gray-600">
            فایل انتخاب‌شده: <span className="font-mono text-xs" dir="ltr">{uploaded.name}</span> ({formatSize(uploaded.size)})
            <span className="text-xs text-gray-400 mr-2">
              — {new Date(uploaded.data.createdAt).toLocaleString('fa-IR')}
            </span>
          </p>
        )}
      </div>

      {pending && (
        <div className="card border-red-200 bg-red-50">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle size={22} className="text-red-600" />
            <h2 className="text-lg font-bold text-red-700">تایید بازگردانی</h2>
          </div>
          <p className="text-sm text-red-800 leading-6 mb-4">
            تمام داده‌های فعلی با محتوای
            <span className="font-mono text-xs mx-1" dir="ltr">
              {restoreTarget ? restoreTarget.name : uploaded?.name}
            </span>
            جایگزین می‌شود. برای تایید، عبارت <span className="font-bold">«{CONFIRM_WORD}»</span> را وارد کنید.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="input-field max-w-xs"
              placeholder={CONFIRM_WORD}
            />
            <button
              onClick={runRestore}
              disabled={restoring || confirmText.trim() !== CONFIRM_WORD}
              className="btn-danger flex items-center gap-2 disabled:opacity-50"
            >
              <RotateCcw size={17} />
              {restoring ? 'در حال بازگردانی...' : 'بازگردانی کن'}
            </button>
            <button onClick={cancelRestore} disabled={restoring} className="btn-secondary">
              انصراف
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
