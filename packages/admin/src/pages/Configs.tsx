import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  KeyRound,
  Search,
  Users,
  CalendarDays,
  CalendarRange,
  Loader2,
  X,
  History,
  Ban,
} from 'lucide-react';
import { featureLabel, formatDateTime } from '../lib/features';

interface ClaimUser {
  id: number;
  telegramId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  bot?: { id: number; name: string } | null;
  configBlocked?: boolean;
  blockedFeatures?: string[];
}

interface Claim {
  id: number;
  email: string;
  createdAt: string;
  user: ClaimUser;
}

interface SummaryRow {
  user: ClaimUser;
  claimedCount: number;
  lastClaimAt: string;
}

const PAGE_SIZE = 20;

function displayName(user: ClaimUser) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'بدون نام';
}

export default function Configs() {
  const [mode, setMode] = useState<'summary' | 'list'>('summary');
  const [bots, setBots] = useState<any[]>([]);
  const [botId, setBotId] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<any>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [historyUser, setHistoryUser] = useState<ClaimUser | null>(null);
  const [history, setHistory] = useState<Claim[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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
    load();
  }, [mode, page, query, botId]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      if (mode === 'list') {
        const res = await axios.get('/api/configs', {
          params: { page, limit: PAGE_SIZE, botId: botId || undefined, search: query || undefined },
        });
        setClaims(res.data.claims);
        setTotal(res.data.total);
        setStats(res.data.stats);
      } else {
        const [summaryRes, statsRes] = await Promise.all([
          axios.get('/api/configs/summary', {
            params: { page, limit: PAGE_SIZE, botId: botId || undefined, search: query || undefined },
          }),
          axios.get('/api/configs', {
            params: { page: 1, limit: 1, botId: botId || undefined },
          }),
        ]);
        setSummary(summaryRes.data.users || []);
        setTotal(summaryRes.data.total);
        setStats(statsRes.data.stats);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در دریافت اطلاعات کانفیگ‌ها');
    } finally {
      setLoading(false);
    }
  };

  const openHistory = async (user: ClaimUser) => {
    setHistoryUser(user);
    setHistory([]);
    setHistoryLoading(true);
    try {
      const res = await axios.get(`/api/users/${user.id}`);
      setHistory(res.data.configClaims || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در دریافت سوابق کاربر');
    } finally {
      setHistoryLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const statCards = [
    { label: 'کل کانفیگ‌های صادرشده', value: stats?.totalClaims, icon: KeyRound, color: 'bg-indigo-50 text-indigo-600' },
    { label: 'کاربران دریافت‌کننده', value: stats?.uniqueUsers, icon: Users, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'امروز', value: stats?.todayClaims, icon: CalendarDays, color: 'bg-amber-50 text-amber-600' },
    { label: 'این ماه', value: stats?.monthClaims, icon: CalendarRange, color: 'bg-sky-50 text-sky-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center shadow-lg">
              <KeyRound size={24} className="text-white" />
            </div>
            کانفیگ‌ها
          </h1>
          <p className="text-gray-500 mt-2">آمار دریافت کانفیگ و سوابق هر کاربر</p>
        </div>
      </div>

      {error && <div className="card bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="card flex items-center gap-3">
              <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${card.color}`}>
                <Icon size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-500 truncate">{card.label}</p>
                <p className="text-xl font-bold text-gray-900">{card.value ?? '—'}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex rounded-lg bg-gray-100 p-1 w-full sm:w-auto">
          {[
            { key: 'summary', label: 'بر اساس کاربر' },
            { key: 'list', label: 'همه کانفیگ‌ها' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setMode(tab.key as 'summary' | 'list');
                setPage(1);
              }}
              className={`flex-1 sm:flex-none px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === tab.key ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
          <div className="relative flex-1 sm:min-w-[260px]">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="جستجوی کاربر یا ایمیل کانفیگ..."
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
            className="input-field sm:max-w-xs"
          >
            <option value="">همه ربات‌ها</option>
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="table-container">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            {mode === 'summary' ? (
              <tr>
                <th className="px-4 py-3 text-right font-medium">کاربر</th>
                <th className="px-4 py-3 text-right font-medium">ربات</th>
                <th className="px-4 py-3 text-center font-medium">تعداد کانفیگ</th>
                <th className="px-4 py-3 text-right font-medium">آخرین دریافت</th>
                <th className="px-4 py-3 text-center font-medium">وضعیت</th>
                <th className="px-4 py-3 text-center font-medium">سوابق</th>
              </tr>
            ) : (
              <tr>
                <th className="px-4 py-3 text-right font-medium">کاربر</th>
                <th className="px-4 py-3 text-right font-medium">ایمیل کانفیگ</th>
                <th className="px-4 py-3 text-right font-medium">ربات</th>
                <th className="px-4 py-3 text-right font-medium">تاریخ</th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400">
                  <Loader2 size={24} className="animate-spin mx-auto" />
                </td>
              </tr>
            ) : mode === 'summary' ? (
              summary.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400">
                    هنوز کانفیگی دریافت نشده است
                  </td>
                </tr>
              ) : (
                summary.map((row) => (
                  <tr key={row.user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{displayName(row.user)}</p>
                      <p className="text-xs text-gray-500">@{row.user.username || '---'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                        {row.user.bot?.name || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">
                        {row.claimedCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap" dir="ltr">
                      {formatDateTime(row.lastClaimAt)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.user.configBlocked ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          <Ban size={12} /> محدود
                        </span>
                      ) : (row.user.blockedFeatures?.length || 0) > 0 ? (
                        <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          {row.user.blockedFeatures!.length} ویژگی محدود
                        </span>
                      ) : (
                        <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          عادی
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openHistory(row.user)}
                        className="mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                      >
                        <History size={14} /> مشاهده
                      </button>
                    </td>
                  </tr>
                ))
              )
            ) : claims.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-gray-400">
                  کانفیگی یافت نشد
                </td>
              </tr>
            ) : (
              claims.map((claim) => (
                <tr key={claim.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{displayName(claim.user)}</p>
                    <p className="text-xs text-gray-500">@{claim.user.username || '---'}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 break-all" dir="ltr">
                    {claim.email}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                      {claim.user.bot?.name || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap" dir="ltr">
                    {formatDateTime(claim.createdAt)}
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

      {historyUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="modal-panel max-w-xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900">سوابق کانفیگ</h3>
                <p className="text-xs text-gray-500 mt-1">{displayName(historyUser)}</p>
              </div>
              <button
                onClick={() => setHistoryUser(null)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 max-h-[60vh] overflow-y-auto">
              {historyLoading ? (
                <div className="py-10 text-center text-gray-400">
                  <Loader2 size={22} className="animate-spin mx-auto" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-center text-gray-400 py-8">سابقه‌ای ثبت نشده است</p>
              ) : (
                <ul className="space-y-2">
                  {history.map((claim, index) => (
                    <li
                      key={claim.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 p-3 bg-gray-50 rounded-lg"
                    >
                      <span className="text-sm text-gray-700">
                        <span className="text-gray-400 ml-1">#{history.length - index}</span>
                        <span className="font-mono text-xs break-all" dir="ltr">
                          {claim.email}
                        </span>
                      </span>
                      <span className="text-xs text-gray-500 whitespace-nowrap" dir="ltr">
                        {formatDateTime(claim.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {historyUser.blockedFeatures?.length ? (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3 mt-4">
                  ویژگی‌های محدود: {historyUser.blockedFeatures.map(featureLabel).join('، ')}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
