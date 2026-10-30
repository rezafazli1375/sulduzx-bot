import { useState, useEffect } from 'react';
import axios from 'axios';
import { Search, Ban, CheckCircle, Users as UsersIcon, Loader2 } from 'lucide-react';

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
              <th className="px-4 py-3 text-center font-medium">تیکت</th>
              <th className="px-4 py-3 text-center font-medium">دانلود</th>
              <th className="px-4 py-3 text-center font-medium">وضعیت</th>
              <th className="px-4 py-3 text-center font-medium">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-gray-400">
                  <Loader2 size={24} className="animate-spin mx-auto" />
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-gray-400">
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
                    <button
                      onClick={() => handleBlock(user.id, user.isBlocked)}
                      className={`mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        user.isBlocked
                          ? 'bg-green-50 text-green-700 hover:bg-green-100'
                          : 'bg-red-50 text-red-700 hover:bg-red-100'
                      }`}
                    >
                      {user.isBlocked ? <CheckCircle size={14} /> : <Ban size={14} />}
                      {user.isBlocked ? 'فعال‌سازی' : 'مسدودسازی'}
                    </button>
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
    </div>
  );
}
