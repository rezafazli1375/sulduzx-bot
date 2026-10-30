import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Radio,
  Settings,
  Shield,
  Users,
  Ticket,
  LogOut,
  Megaphone,
  ShoppingBag,
  LayoutGrid,
  Type,
  Zap,
  Bot,
  DatabaseBackup,
  UserCog,
  KeyRound,
  Menu as MenuIcon,
  X,
} from 'lucide-react';

const menuItems = [
  { path: '/', label: 'داشبورد', icon: LayoutDashboard },
  { path: '/bots', label: 'ربات‌ها', icon: Bot },
  { path: '/shop', label: 'فروشگاه', icon: ShoppingBag },
  { path: '/menu', label: 'منوی ربات', icon: LayoutGrid },
  { path: '/texts', label: 'متن‌های ربات', icon: Type },
  { path: '/channels', label: 'کانال‌ها', icon: Radio },
  { path: '/proxies', label: 'پروکسی‌ها', icon: Shield },
  { path: '/users', label: 'کاربران', icon: Users },
  { path: '/configs', label: 'کانفیگ‌ها', icon: KeyRound },
  { path: '/tickets', label: 'تیکت‌ها', icon: Ticket },
  { path: '/broadcast', label: 'پیام همگانی', icon: Megaphone },
  { path: '/settings', label: 'تنظیمات', icon: Settings },
  { path: '/backup', label: 'بکاپ و بازگردانی', icon: DatabaseBackup },
  { path: '/account', label: 'حساب کاربری', icon: UserCog },
];

export default function Layout() {
  const { admin, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      <header className="lg:hidden sticky top-0 z-30 bg-slate-900 text-white px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <Zap size={20} className="text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold">سولدوز بات</p>
            <p className="text-[11px] text-slate-400">پنل مدیریت</p>
          </div>
        </div>
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 rounded-lg hover:bg-slate-700/60 transition-colors"
          aria-label="باز کردن منو"
        >
          <MenuIcon size={22} />
        </button>
      </header>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 right-0 z-50 w-72 max-w-[85vw] bg-gradient-to-b from-slate-900 to-slate-800 text-white shadow-xl flex flex-col h-full overflow-y-auto transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-5 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Zap size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">سولدوز بات</h1>
              <p className="text-xs text-slate-400">پنل مدیریت</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-2 rounded-lg hover:bg-slate-700/60 transition-colors"
            aria-label="بستن منو"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-l from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/30'
                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
                }`}
              >
                <Icon size={20} className="shrink-0" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <div className="bg-slate-700/50 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                {admin?.username?.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{admin?.username}</p>
                <p className="text-xs text-slate-400">{admin?.role}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 w-full px-3 py-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors text-sm"
            >
              <LogOut size={16} />
              <span>خروج از حساب</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="p-4 md:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
