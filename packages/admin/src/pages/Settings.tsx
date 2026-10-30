import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Settings as SettingsIcon, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';

function SecretInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative max-w-md">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field pl-11 font-mono"
        dir="ltr"
        autoComplete="new-password"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600"
        aria-label={visible ? 'پنهان کردن رمز' : 'نمایش رمز'}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await axios.get('/api/settings');
      setSettings(res.data);
    } catch (err) {
      setError('خطا در بارگذاری تنظیمات');
    }
  };

  const handleChange = (key: string, value: string) => {
    setSettings(settings.map((s) => (s.key === key ? { ...s, value } : s)));
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      await axios.put('/api/settings/batch', {
        settings: settings.map((s) => ({ key: s.key, value: s.value })),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError('خطا در ذخیره تنظیمات');
    } finally {
      setLoading(false);
    }
  };

  const sections: { title: string; icon: string; color: string; hint?: string; keys: string[] }[] = [
    {
      title: 'عمومی',
      icon: '⚙️',
      color: 'from-gray-500 to-gray-600',
      keys: ['bot_enabled', 'welcome_message'],
    },
    {
      title: 'کانفیگ رایگان',
      icon: '🎁',
      color: 'from-blue-500 to-blue-600',
      keys: ['free_account_enabled', 'free_data_limit_gb', 'free_days_limit', 'free_config_limit_type', 'free_config_max_count'],
    },
    {
      title: 'عضویت کانال',
      icon: '📢',
      color: 'from-purple-500 to-purple-600',
      keys: ['force_join_channels'],
    },
    {
      title: 'رفرال',
      icon: '👥',
      color: 'from-green-500 to-emerald-600',
      keys: ['referral_enabled', 'referral_reward_points'],
    },
    {
      title: 'امتیاز',
      icon: '⭐',
      color: 'from-amber-500 to-orange-600',
      keys: ['points_enabled', 'daily_checkin_points'],
    },
    {
      title: 'دانلودر',
      icon: '📥',
      color: 'from-cyan-500 to-cyan-600',
      keys: ['downloader_enabled', 'max_download_size_mb', 'max_downloads_per_day'],
    },
    {
      title: 'پروکسی دانلودر',
      icon: '🧦',
      color: 'from-sky-500 to-blue-600',
      hint: 'اگر دانلود از یوتیوب/اینستاگرام روی سرور اصلی کار نکرد، پروکسی خودتان را اینجا وارد و فعال کنید.',
      keys: ['ytdlp_proxy_enabled', 'ytdlp_proxy_url'],
    },
    {
      title: 'پنل x-ui (ایجاد کانفیگ)',
      icon: '🔌',
      color: 'from-violet-500 to-purple-600',
      hint: 'این تنظیمات تعیین می‌کند ربات کانفیگ‌ها را روی کدام سرور و اینباند بسازد. تغییرات بلافاصله اعمال می‌شود و نیازی به ری‌استارت نیست.',
      keys: ['panel_base_url', 'panel_username', 'panel_password', 'panel_inbound_id'],
    },
    {
      title: 'فروشگاه',
      icon: '🛒',
      color: 'from-teal-500 to-emerald-600',
      keys: ['shop_enabled'],
    },
    {
      title: 'تبدیل ویس',
      icon: '🎙️',
      color: 'from-rose-500 to-pink-600',
      keys: ['voice_converter_enabled', 'voice_convert_max_mb', 'voice_convert_max_seconds'],
    },
    {
      title: 'تبدیل Word به PDF',
      icon: '📄',
      color: 'from-slate-500 to-blue-600',
      hint: 'فایل‌های doc / docx / odt / rtf با LibreOffice داخل سرور به PDF تبدیل می‌شوند. حداکثر حجم مؤثر ۲۰ مگابایت است (محدودیت دانلود فایل تلگرام).',
      keys: ['word_pdf_enabled', 'word_pdf_max_mb'],
    },
    {
      title: 'تبدیل ویدیو به MP3',
      icon: '🎬',
      color: 'from-fuchsia-500 to-purple-600',
      hint: 'صدای ویدیوهای mp4 / mkv / mov / webm / avi با ffmpeg جدا و به MP3 تبدیل می‌شود. حداکثر حجم مؤثر ۲۰ مگابایت است (محدودیت دانلود فایل تلگرام).',
      keys: ['video_mp3_enabled', 'video_mp3_max_mb'],
    },
    {
      title: 'پشتیبانی',
      icon: '🎫',
      color: 'from-pink-500 to-rose-600',
      keys: ['support_enabled'],
    },
    {
      title: 'وضعیت سرور',
      icon: '🖥️',
      color: 'from-indigo-500 to-indigo-600',
      keys: ['server_status_check'],
    },
  ];

  const limitTypeOptions = [
    { value: 'none', label: 'بدون محدودیت' },
    { value: 'daily', label: 'روزانه' },
    { value: 'weekly', label: 'هفتگی' },
    { value: 'monthly', label: 'ماهانه' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-gray-500 to-gray-700 rounded-xl flex items-center justify-center shadow-lg">
              <SettingsIcon size={24} className="text-white" />
            </div>
            تنظیمات
          </h1>
          <p className="text-gray-500 mt-2">مدیریت تنظیمات ربات و سرویس‌ها</p>
        </div>
        <button
          onClick={handleSave}
          disabled={loading}
          className="btn-success flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              در حال ذخیره...
            </>
          ) : (
            <>
              <Save size={18} />
              ذخیره تغییرات
            </>
          )}
        </button>
      </div>

      {saved && (
        <div className="card bg-green-50 border-green-200 flex items-center gap-3">
          <CheckCircle size={20} className="text-green-600" />
          <p className="text-green-700 font-medium">تنظیمات با موفقیت ذخیره شد</p>
        </div>
      )}

      {error && (
        <div className="card bg-red-50 border-red-200 flex items-center gap-3">
          <AlertCircle size={20} className="text-red-600" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <div className="grid gap-6">
        {sections.map((section) => (
          <div key={section.title} className="card">
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${section.color} flex items-center justify-center text-lg`}>
                {section.icon}
              </div>
              <h2 className="text-lg font-bold text-gray-900">{section.title}</h2>
            </div>
            {section.hint && (
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3 mb-5 leading-6">
                {section.hint}
              </p>
            )}
            <div className="space-y-5">
              {section.keys.map((key) => {
                const setting = settings.find((s) => s.key === key);
                if (!setting) return null;

                return (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {setting.description || key}
                    </label>
                    {setting.type === 'BOOLEAN' ? (
                      <label className="flex items-center gap-3 cursor-pointer">
                        <div className="relative">
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={setting.value === 'true'}
                            onChange={(e) => handleChange(key, e.target.checked ? 'true' : 'false')}
                          />
                          <div className={`w-12 h-6 rounded-full transition-colors ${
                            setting.value === 'true' ? 'bg-green-500' : 'bg-gray-300'
                          }`}></div>
                          <div className={`absolute top-0.5 right-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                            setting.value === 'true' ? 'translate-x-6' : ''
                          }`}></div>
                        </div>
                        <span className="text-sm text-gray-600">
                          {setting.value === 'true' ? 'فعال' : 'غیرفعال'}
                        </span>
                      </label>
                    ) : key === 'free_config_limit_type' ? (
                      <select
                        value={setting.value}
                        onChange={(e) => handleChange(key, e.target.value)}
                        className="input-field max-w-xs"
                      >
                        {limitTypeOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    ) : key === 'panel_password' ? (
                      <SecretInput
                        value={setting.value}
                        onChange={(value) => handleChange(key, value)}
                      />
                    ) : key === 'ytdlp_proxy_url' ? (
                      <>
                        <input
                          type="text"
                          value={setting.value}
                          onChange={(e) => handleChange(key, e.target.value)}
                          className="input-field font-mono text-sm"
                          placeholder="socks5h://1.2.3.4:1080"
                          dir="ltr"
                        />
                        <p className="text-xs text-gray-400 mt-2 leading-5">
                          وقتی فعال باشد، دانلودر به‌جای پروکسی پیش‌فرض سرور از این پروکسی استفاده
                          می‌کند. فرمت‌های پشتیبانی‌شده: socks5h://، socks5://، http://، https://
                        </p>
                      </>
                    ) : setting.type === 'NUMBER' ? (
                      <input
                        type="number"
                        value={setting.value}
                        onChange={(e) => handleChange(key, e.target.value)}
                        className="input-field max-w-xs"
                      />
                    ) : (
                      <input
                        type="text"
                        value={setting.value}
                        onChange={(e) => handleChange(key, e.target.value)}
                        className="input-field"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
