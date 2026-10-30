import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Search,
  Ban,
  CheckCircle,
  Users as UsersIcon,
  Loader2,
  SlidersHorizontal,
  X,
  KeyRound,
} from 'lucide-react';
import { FEATURE_LABELS, formatDateTime } from '../lib/features';

interface Restrictions {
  configBlocked: boolean;
  configQuotaOverride: string;
  blockedFeatures: string[];
}

const emptyRestrictions: Restrictions = {
  configBlocked: false,
  configQuotaOverride: '',
  blockedFeatures: [],
};

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bots, setBots] = useState<any[]>([]);
  const [botId, setBotId] = useState('');

  const [selected, setSelected] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [claims, setClaims] = useState<any[]>([]);
  const [form, setForm] = useState<Restrictions>(emptyRestrictions);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    axios
      .get('/api/bots')
      .then((res) => setBots(res.data))
      .catch((err) => console.error('Load bots error:', err));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    loadUsers();
  }, [page, query, botId]);

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('/api/users', {
        params: {
          page,
          limit: 20,
          search: query || undefined,
          botId: botId || undefined,
        },
      });
      setUsers(res.data.users);
      setTotal(res.data.total);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در دریافت کاربران');
    } finally {
      setLoading(false);
    }
  };

  const handleBlock = async (id: number, isBlocked: boolean) => {
    try {
      await axios.put(`/api/users/${id}/block`, { isBlocked: !isBlocked });
      loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در تغییر وضعیت کاربر');
    }
  };

  const openRestrictions = async (user: any) => {
    setSelected(user);
    setClaims([]);
    setModalError('');
    setForm({
      configBlocked: !!user.configBlocked,
      configQuotaOverride:
        user.configQuotaOverride === null || user.configQuotaOverride === undefined
          ? ''
          : String(user.configQuotaOverride),
      blockedFeatures: Array.isArray(user.blockedFeatures) ? [...user.blockedFeatures] : [],
    });
    setDetailLoading(true);
    try {
      const res = await axios.get(`/api/users/${user.id}`);
      setClaims(res.data.configClaims || []);
    } catch (err: any) {
      setModalError(err.response?.data?.error || 'خطا در دریافت سوابق کاربر');
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleFeature = (key: string) => {
    setForm((prev) => ({
      ...prev,
      blockedFeatures: prev.blockedFeatures.includes(key)
        ? prev.blockedFeatures.filter((item) => item !== key)
        : [...prev.blockedFeatures, key],
    }));
  };

  const saveRestrictions = async () => {
    if (!selected) return;
    setSaving(true);
    setModalError('');
    try {
      const res = await axios.put(`/api/users/${selected.id}/restrictions`, {
        configBlocked: form.configBlocked,
        configQuotaOverride: form.configQuotaOverride === '' ? null : Number(form.configQuotaOverride),
        blockedFeatures: form.blockedFeatures,
      });
      setSelected({ ...selected, ...res.data });
      loadUsers();
    } catch (err: any) {
      setModalError(err.response?.data?.error || 'خطا در ذخیره محدودیت‌ها');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
              <UsersIcon size={24} className="text-white" />
            </div>
            کاربران
          </h1>
          <p className="text-gray-500 mt-2">{total} کاربر ثبت‌شده</p>
        </div>
      </div>

      {error && (
        <div className="card bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[260px]">
          <Search
            size={18}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="جستجو بر اساس نام، یوزرنیم یا آیدی..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pr-10"
          />
        </div>
        <select
          value={botId}
          onChange={(e) => {
            setBotId(e.target.value);
            setPage(1);
          }}
          className="input-field max-w-xs"
        >
          <option value="">همه ربات‌ها</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
      </div>

      <div className="table-container">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-3 text-right font-medium">کاربر</th>
              <th className="px-4 py-3 text-right font-medium">ربات</th>
              <th className="px-4 py-3 text-right font-medium">شناسه تلگرام</th>
              <th className="px-4 py-3 text-center font-medium">امتیاز</th>
              <th className="px-4 py-3 text-center font-medium">کانفیگ</th>
              <th className="px-4 py-3 text-center font-medium">تیکت</th>
              <th className="px-4 py-3 text-center font-medium">دانلود</th>
              <th className="px-4 py-3 text-center font-medium">وضعیت</th>
              <th className="px-4 py-3 text-center font-medium">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-gray-400">
                  <Loader2 size={24} className="animate-spin mx-auto" />
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-gray-400">
                  کاربری یافت نشد
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">
                      {[user.firstName, user.lastName].filter(Boolean).join(' ') || 'بدون نام'}
                    </p>
                    <p className="text-xs text-gray-500">@{user.username || '---'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                      {user.bot?.name || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600" dir="ltr">
                    {user.telegramId}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">{user.points}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                        user.configBlocked
                          ? 'bg-red-100 text-red-700'
                          : (user._count?.configClaims ?? 0) > 0
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {user.configBlocked && <Ban size={12} />}
                      {user._count?.configClaims ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">
                    {user._count?.tickets ?? 0}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">
                    {user._count?.downloads ?? 0}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                        user.isBlocked
                          ? 'bg-red-100 text-red-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {user.isBlocked ? 'مسدود' : 'فعال'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => openRestrictions(user)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                      >
                        <SlidersHorizontal size={14} />
                        محدودیت‌ها
                      </button>
                      <button
                        onClick={() => handleBlock(user.id, user.isBlocked)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          user.isBlocked
                            ? 'bg-green-50 text-green-700 hover:bg-green-100'
                            : 'bg-red-50 text-red-700 hover:bg-red-100'
                        }`}
                      >
                        {user.isBlocked ? <CheckCircle size={14} /> : <Ban size={14} />}
                        {user.isBlocked ? 'فعال‌سازی' : 'مسدودسازی'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          قبلی
        </button>
        <span className="text-sm text-gray-600">
          صفحه {page} از {totalPages}
        </span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={page >= totalPages}
          className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          بعدی
        </button>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="modal-panel max-w-2xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <SlidersHorizontal size={18} className="text-indigo-600" />
                  محدودیت‌های کاربر
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {[selected.firstName, selected.lastName].filter(Boolean).join(' ') ||
                    selected.username ||
                    'بدون نام'}{' '}
                  — <span dir="ltr">@{selected.username || '---'}</span>
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
              {modalError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                  {modalError}
                </div>
              )}

              <div className="space-y-3">
                <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                  <KeyRound size={16} className="text-indigo-500" />
                  دریافت کانفیگ
                </h4>

                <label className="flex items-center justify-between gap-4 p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-700">مسدود کردن دریافت کانفیگ</span>
                  <input
                    type="checkbox"
                    checked={form.configBlocked}
                    onChange={(e) => setForm((prev) => ({ ...prev, configBlocked: e.target.checked }))}
                    className="w-5 h-5 accent-red-600"
                  />
                </label>

                <div className="p-3 bg-gray-50 rounded-lg">
                  <label className="text-sm text-gray-700 block mb-2">
                    سهمیه اختصاصی (خالی = سهمیه پیش‌فرض سیستم)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={form.configQuotaOverride}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, configQuotaOverride: e.target.value }))
                    }
                    placeholder="مثلاً 3"
                    className="input-field"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    مقدار ۰ یعنی دریافت کانفیگ کاملاً بسته شود.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-bold text-gray-800">امکانات ربات</h4>
                <p className="text-xs text-gray-500">تیک‌خورده‌ها برای این کاربر غیرفعال می‌شوند.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {FEATURE_LABELS.map((feature) => (
                    <label
                      key={feature.key}
                      className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-700"
                    >
                      <span>{feature.label}</span>
                      <input
                        type="checkbox"
                        checked={form.blockedFeatures.includes(feature.key)}
                        onChange={() => toggleFeature(feature.key)}
                        className="w-5 h-5 accent-indigo-600"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-bold text-gray-800">
                  سوابق کانفیگ ({claims.length})
                </h4>
                {detailLoading ? (
                  <div className="py-6 text-center text-gray-400">
                    <Loader2 size={20} className="animate-spin mx-auto" />
                  </div>
                ) : claims.length === 0 ? (
                  <p className="text-sm text-gray-400">این کاربر هنوز کانفیگی دریافت نکرده است.</p>
                ) : (
                  <ul className="space-y-2">
                    {claims.map((claim, index) => (
                      <li
                        key={claim.id}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 p-3 bg-gray-50 rounded-lg"
                      >
                        <span className="text-xs text-gray-700 break-all" dir="ltr">
                          <span className="text-gray-400 ml-1">#{claims.length - index}</span>
                          {claim.email}
                        </span>
                        <span className="text-xs text-gray-500 whitespace-nowrap" dir="ltr">
                          {formatDateTime(claim.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-100">
              <button onClick={() => setSelected(null)} className="btn-secondary">
                بستن
              </button>
              <button
                onClick={saveRestrictions}
                disabled={saving}
                className="btn-primary disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                ذخیره محدودیت‌ها
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
