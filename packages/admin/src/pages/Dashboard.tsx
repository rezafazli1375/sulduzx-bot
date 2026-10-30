import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Users,
  Radio,
  Ticket,
  Download,
  Shield,
  TrendingUp,
  Activity,
  Bot,
  KeyRound,
} from 'lucide-react';
import { formatDateTime } from '../lib/features';

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [recentUsers, setRecentUsers] = useState<any[]>([]);
  const [recentTickets, setRecentTickets] = useState<any[]>([]);
  const [recentClaims, setRecentClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('/api/dashboard');
      setStats(res.data.stats);
      setRecentUsers(res.data.recentUsers || []);
      setRecentTickets(res.data.recentTickets || []);
      setRecentClaims(res.data.recentClaims || []);
    } catch (err: any) {
      console.error('Dashboard load error:', err);
      setError(err.response?.data?.error || 'خطا در دریافت اطلاعات داشبورد');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="card bg-red-50 border-red-200 flex items-center justify-between">
        <p className="text-red-700">{error || 'اطلاعات در دسترس نیست'}</p>
        <button onClick={loadDashboard} className="btn-primary">
          تلاش مجدد
        </button>
      </div>
    );
  }

  const statCards = [
    { label: 'کل کاربران', value: stats.totalUsers, icon: Users, color: 'from-blue-500 to-blue-600', bg: 'bg-blue-50', text: 'text-blue-600' },
    { label: 'کاربران فعال', value: stats.activeUsers, icon: Activity, color: 'from-green-500 to-emerald-600', bg: 'bg-green-50', text: 'text-green-600' },
    { label: 'ربات‌های فعال', value: stats.totalBots ?? 0, icon: Bot, color: 'from-indigo-500 to-violet-600', bg: 'bg-indigo-50', text: 'text-indigo-600' },
    { label: 'کانال‌ها', value: stats.totalChannels, icon: Radio, color: 'from-purple-500 to-purple-600', bg: 'bg-purple-50', text: 'text-purple-600' },
    { label: 'تیکت‌های باز', value: stats.openTickets, icon: Ticket, color: 'from-amber-500 to-orange-600', bg: 'bg-amber-50', text: 'text-amber-600' },
    { label: 'دانلودها', value: stats.totalDownloads, icon: Download, color: 'from-cyan-500 to-cyan-600', bg: 'bg-cyan-50', text: 'text-cyan-600' },
    { label: 'کاربران کانفیگ‌گرفته', value: stats.configUsers ?? 0, icon: KeyRound, color: 'from-teal-500 to-emerald-600', bg: 'bg-teal-50', text: 'text-teal-600' },
    { label: 'کانفیگ‌های صادرشده', value: stats.totalConfigClaims ?? 0, icon: KeyRound, color: 'from-indigo-500 to-purple-600', bg: 'bg-indigo-50', text: 'text-indigo-600' },
    { label: 'پروکسی‌ها', value: stats.totalProxies, icon: Shield, color: 'from-pink-500 to-rose-600', bg: 'bg-pink-50', text: 'text-pink-600' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">داشبورد</h1>
          <p className="text-gray-500 mt-1">نمای کلی از وضعیت سیستم</p>
        </div>
        <button
          onClick={loadDashboard}
          className="btn-primary flex items-center gap-2"
        >
          <TrendingUp size={18} />
          بروزرسانی
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {statCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div
              key={i}
              className="card hover:shadow-md transition-shadow duration-200"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 mb-1">{card.label}</p>
                  <p className="text-3xl font-bold text-gray-900">{card.value}</p>
                </div>
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center shadow-lg`}>
                  <Icon size={26} className="text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Users size={20} className="text-blue-500" />
              کاربران اخیر
            </h2>
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full">
              {recentUsers.length} کاربر
            </span>
          </div>
          <div className="space-y-3">
            {recentUsers.length === 0 ? (
              <p className="text-gray-400 text-center py-8">کاربری ثبت نشده است</p>
            ) : (
              recentUsers.map((user) => (
                <div key={user.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                      {(user.firstName || user.username || '?').charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{user.firstName || user.username || 'بدون نام'}</p>
                      <p className="text-xs text-gray-500">@{user.username || '---'}</p>
                    </div>
                  </div>
                  <div className="text-left">
                    {user.bot?.name && (
                      <p className="text-[11px] text-slate-500 mb-1">{user.bot.name}</p>
                    )}
                    <p className="text-xs text-gray-400">
                      {new Date(user.createdAt).toLocaleDateString('fa-IR')}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Ticket size={20} className="text-amber-500" />
              تیکت‌های اخیر
            </h2>
            <span className="text-xs bg-amber-50 text-amber-600 px-2 py-1 rounded-full">
              {recentTickets.length} تیکت
            </span>
          </div>
          <div className="space-y-3">
            {recentTickets.length === 0 ? (
              <p className="text-gray-400 text-center py-8">تیکتی ثبت نشده است</p>
            ) : (
              recentTickets.map((ticket) => (
                <div key={ticket.id} className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-gray-700">#{ticket.id}</span>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      ticket.status === 'OPEN'
                        ? 'bg-amber-100 text-amber-700'
                        : ticket.status === 'IN_PROGRESS'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {ticket.status === 'OPEN' ? 'باز' : ticket.status === 'IN_PROGRESS' ? 'در حال بررسی' : 'بسته'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mb-1">{ticket.subject}</p>
                  <p className="text-xs text-gray-400">
                    {ticket.user?.firstName || ticket.user?.username || 'کاربر'}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card lg:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <KeyRound size={20} className="text-indigo-500" />
              آخرین کانفیگ‌های صادرشده
            </h2>
            <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-full">
              {recentClaims.length} مورد
            </span>
          </div>
          <div className="space-y-3">
            {recentClaims.length === 0 ? (
              <p className="text-gray-400 text-center py-8">هنوز کانفیگی صادر نشده است</p>
            ) : (
              recentClaims.map((claim) => (
                <div
                  key={claim.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {[claim.user?.firstName, claim.user?.lastName].filter(Boolean).join(' ') ||
                        claim.user?.username ||
                        'کاربر'}
                    </p>
                    <p className="text-xs text-gray-500 break-all" dir="ltr">
                      {claim.email}
                    </p>
                  </div>
                  <div className="text-left shrink-0">
                    {claim.user?.bot?.name && (
                      <p className="text-[11px] text-slate-500 mb-1">{claim.user.bot.name}</p>
                    )}
                    <p className="text-xs text-gray-400" dir="ltr">
                      {formatDateTime(claim.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
