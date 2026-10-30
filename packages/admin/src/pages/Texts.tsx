import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Save, Type, Search, Info } from 'lucide-react';

type BotText = {
  id: number;
  key: string;
  title: string;
  value: string;
};

const GROUPS: Record<string, { label: string; icon: string }> = {
  main_menu: { label: 'منوی اصلی', icon: '🏠' },
  button: { label: 'دکمه‌ها', icon: '🔘' },
  free: { label: 'کانفیگ رایگان', icon: '🎁' },
  downloader: { label: 'دانلودر', icon: '📥' },
  voice: { label: 'تبدیل ویس', icon: '🎙️' },
  shop: { label: 'فروشگاه', icon: '🛒' },
  support: { label: 'پشتیبانی', icon: '🎫' },
  proxy: { label: 'پروکسی', icon: '🔐' },
  referral: { label: 'زیرمجموعه', icon: '👥' },
  points: { label: 'امتیازها', icon: '💰' },
  status: { label: 'وضعیت سرور', icon: '📊' },
};

export default function Texts() {
  const [texts, setTexts] = useState<BotText[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadTexts();
  }, []);

  const loadTexts = async () => {
    try {
      const res = await axios.get('/api/texts');
      setTexts(res.data);
    } catch {
      setError('خطا در بارگذاری متن‌های ربات');
    }
  };

  const handleChange = (key: string, value: string) => {
    setTexts(texts.map((t) => (t.key === key ? { ...t, value } : t)));
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.put('/api/texts/batch', { texts });
      setTexts(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ذخیره متن‌ها');
    } finally {
      setLoading(false);
    }
  };

  const groups = useMemo(() => {
    const filtered = texts.filter(
      (t) =>
        !search.trim() ||
        t.title.includes(search) ||
        t.key.includes(search) ||
        t.value.includes(search)
    );
    const byPrefix = new Map<string, BotText[]>();
    for (const item of filtered) {
      const prefix = item.key.split('.')[0];
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
      byPrefix.get(prefix)!.push(item);
    }
    const known = Object.keys(GROUPS).filter((p) => byPrefix.has(p));
    const unknown = Array.from(byPrefix.keys()).filter((p) => !GROUPS[p]);
    return [...known, ...unknown].map((prefix) => ({
      prefix,
      label: GROUPS[prefix]?.label || prefix,
      icon: GROUPS[prefix]?.icon || '📝',
      items: byPrefix.get(prefix)!,
    }));
  }, [texts, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-fuchsia-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <Type size={24} className="text-white" />
            </div>
            متن‌های ربات
          </h1>
          <p className="text-gray-500 mt-2">ویرایش متن پیام‌های ربات بدون نیاز به تغییر کد</p>
        </div>
        <button
          onClick={handleSave}
          disabled={loading}
          className="btn-success flex items-center gap-2 disabled:opacity-50"
        >
          <Save size={18} />
          {loading ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
        </button>
      </div>

      <div className="card bg-blue-50 border-blue-200 flex items-start gap-3">
        <Info size={20} className="text-blue-600 mt-0.5 shrink-0" />
        <p className="text-sm text-blue-800 leading-6">
          برای پیام‌های کانفیگ رایگان می‌توانید از متغیرهایی مثل <code>{'{{period}}'}</code>،{' '}
          <code>{'{{count}}'}</code>، <code>{'{{used}}'}</code>، <code>{'{{next}}'}</code>،{' '}
          <code>{'{{gb}}'}</code>، <code>{'{{days}}'}</code>، <code>{'{{expiry}}'}</code> و{' '}
          <code>{'{{links}}'}</code> استفاده کنید. سایر گروه‌ها متغیرهای خودشان را دارند؛ متغیرها را
          بدون تغییر نگه دارید تا مقدارشان جایگزین شود.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="جستجو در کلید، عنوان یا متن..."
          className="input-field pr-10"
        />
      </div>

      {saved && (
        <div className="card bg-green-50 border-green-200 text-green-700 text-sm">
          متن‌ها با موفقیت ذخیره شد
        </div>
      )}

      {error && <div className="card bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>}

      {groups.length === 0 && (
        <div className="card text-center text-gray-400 py-12">موردی یافت نشد</div>
      )}

      <div className="grid gap-6">
        {groups.map((group) => (
          <div key={group.prefix} className="card">
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-lg">
                {group.icon}
              </div>
              <h2 className="text-lg font-bold text-gray-900">{group.label}</h2>
              <span className="text-xs text-gray-400">{group.items.length} متن</span>
            </div>
            <div className="space-y-5">
              {group.items.map((item) => (
                <div key={item.key}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">{item.title}</label>
                    <span className="text-xs text-gray-400 font-mono">{item.key}</span>
                  </div>
                  <textarea
                    value={item.value}
                    onChange={(e) => handleChange(item.key, e.target.value)}
                    className="input-field font-mono text-sm leading-6 min-h-[90px] resize-y"
                    rows={Math.min(12, Math.max(3, Math.ceil(item.value.length / 70)))}
                    maxLength={4000}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
