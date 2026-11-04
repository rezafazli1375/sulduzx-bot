import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Bot as BotIcon,
  Plus,
  Edit,
  Trash2,
  X,
  Info,
  Eye,
  EyeOff,
  CircleCheck,
  CircleX,
  CirclePause,
  ShieldCheck,
  Gamepad2,
  Sparkles,
} from 'lucide-react';
import { BOT_FEATURE_LABELS, GAME_LABELS, featureLabel, gameLabel } from '../lib/features';

type BotRow = {
  id: number;
  name: string;
  token: string;
  username: string | null;
  isActive: boolean;
  sortOrder: number;
  blockedFeatures?: string[] | null;
  blockedGames?: string[] | null;
  usersCount: number;
  channelsCount: number;
  runtime: { running: boolean; username?: string; error?: string };
};

const ALL_FEATURE_KEYS = BOT_FEATURE_LABELS.map((item) => item.key);
const ALL_GAME_KEYS = GAME_LABELS.map((item) => item.key);

const emptyForm = {
  name: '',
  token: '',
  isActive: true,
  sortOrder: 50,
};

/** فهرست «مجاز»ها را به فهرست «مسدود»ها تبدیل می‌کند (همان چیزی که در دیتابیس می‌ماند) */
function toBlocked(all: string[], allowed: string[]) {
  return all.filter((key) => !allowed.includes(key));
}

function toAllowed(all: string[], blocked: string[] | null | undefined) {
  const blockedSet = new Set(blocked ?? []);
  return all.filter((key) => !blockedSet.has(key));
}

export default function Bots() {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BotRow | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadBots();
  }, []);

  const loadBots = async () => {
    try {
      const res = await axios.get('/api/bots');
      setBots(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در دریافت ربات‌ها');
    }
  };

  const openCreate = () => {
    setEditing(null);
    // ربات تازه: همهٔ بخش‌ها و بازی‌ها آزاد
    setForm({
      ...emptyForm,
      allowedFeatures: [...ALL_FEATURE_KEYS],
      allowedGames: [...ALL_GAME_KEYS],
    });
    setShowToken(false);
    setError('');
    setShowModal(true);
  };

  const openEdit = (bot: BotRow) => {
    setEditing(bot);
    setForm({
      name: bot.name,
      token: bot.token,
      isActive: bot.isActive,
      sortOrder: bot.sortOrder,
      allowedFeatures: toAllowed(ALL_FEATURE_KEYS, bot.blockedFeatures),
      allowedGames: toAllowed(ALL_GAME_KEYS, bot.blockedGames),
    });
    setShowToken(false);
    setError('');
    setShowModal(true);
  };

  const toggleIn = (field: 'allowedFeatures' | 'allowedGames', key: string) => {
    const current: string[] = form[field] ?? [];
    setForm({
      ...form,
      [field]: current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    });
  };

  const setAll = (field: 'allowedFeatures' | 'allowedGames', keys: string[]) => {
    setForm({ ...form, [field]: [...keys] });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        token: form.token,
        isActive: form.isActive,
        sortOrder: form.sortOrder,
        blockedFeatures: toBlocked(ALL_FEATURE_KEYS, form.allowedFeatures ?? []),
        blockedGames: toBlocked(ALL_GAME_KEYS, form.allowedGames ?? []),
      };
      if (editing) {
        await axios.put(`/api/bots/${editing.id}`, payload);
      } else {
        await axios.post('/api/bots', payload);
      }
      setShowModal(false);
      await loadBots();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ذخیره ربات');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (bot: BotRow) => {
    if (!window.confirm(`حذف ربات «${bot.name}»؟ این کار فقط برای ربات بدون کاربر/کانال ممکن است.`)) {
      return;
    }
    try {
      await axios.delete(`/api/bots/${bot.id}`);
      loadBots();
    } catch (err: any) {
      alert(err.response?.data?.error || 'خطا در حذف ربات');
    }
  };

  const statusBadge = (bot: BotRow) => {
    if (!bot.isActive) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          <CirclePause size={13} />
          غیرفعال
        </span>
      );
    }
    if (bot.runtime?.running) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
          <CircleCheck size={13} />
          در حال اجرا
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700"
        title={bot.runtime?.error || ''}
      >
        <CircleX size={13} />
        خطا
      </span>
    );
  };

  /** خلاصهٔ دسترسی ربات در جدول: «همهٔ بخش‌ها» یا تعداد بخش/بازی‌های باز */
  const accessBadge = (bot: BotRow) => {
    const blockedFeatures = toBlocked(ALL_FEATURE_KEYS, toAllowed(ALL_FEATURE_KEYS, bot.blockedFeatures));
    const blockedGames = toBlocked(ALL_GAME_KEYS, toAllowed(ALL_GAME_KEYS, bot.blockedGames));

    if (blockedFeatures.length === 0 && blockedGames.length === 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
          <ShieldCheck size={13} />
          همهٔ بخش‌ها
        </span>
      );
    }

    const details = [...blockedFeatures.map(featureLabel), ...blockedGames.map(gameLabel)];
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
        title={`غیرفعال: ${details.join('، ')}`}
      >
        <ShieldCheck size={13} />
        {`${ALL_FEATURE_KEYS.length - blockedFeatures.length} بخش · ${
          ALL_GAME_KEYS.length - blockedGames.length
        } بازی`}
      </span>
    );
  };

  const renderCheckboxGrid = (
    field: 'allowedFeatures' | 'allowedGames',
    items: { key: string; label: string }[],
    allKeys: string[]
  ) => {
    const allowed: string[] = form[field] ?? [];
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {items.map((item) => (
          <label
            key={item.key}
            className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none hover:text-gray-900"
          >
            <input
              type="checkbox"
              checked={allowed.includes(item.key)}
              onChange={() => toggleIn(field, item.key)}
              className="w-4 h-4 text-cyan-600 rounded border-gray-300"
            />
            <span>{item.label}</span>
          </label>
        ))}
        <div className="flex items-center gap-2 sm:col-span-2 pt-1">
          <button
            type="button"
            onClick={() => setAll(field, allKeys)}
            className="text-xs text-cyan-700 hover:text-cyan-900 font-medium"
          >
            انتخاب همه
          </button>
          <span className="text-gray-300">|</span>
          <button
            type="button"
            onClick={() => setAll(field, [])}
            className="text-xs text-gray-500 hover:text-gray-700 font-medium"
          >
            برداشتن همه
          </button>
          <span className="text-xs text-gray-400 mr-auto">{`${allowed.length} از ${allKeys.length}`}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <BotIcon size={24} className="text-white" />
            </div>
            ربات‌ها
          </h1>
          <p className="text-gray-500 mt-2">
            مدیریت توکن، وضعیت و سطح دسترسی ربات‌های تلگرامی متصل به سامانه
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          افزودن ربات
        </button>
      </div>

      <div className="card bg-blue-50 border-blue-200 flex items-start gap-3">
        <Info size={20} className="text-blue-600 mt-0.5 shrink-0" />
        <p className="text-sm text-blue-800 leading-6">
          هر ربات کاربران، امتیازها، کانال‌های عضویت اجباری و آمار مستقل خودش را دارد. با ذخیره یا
          تغییر توکن، همان ربات به‌صورت خودکار ری‌استارت می‌شود و بقیه ربات‌ها بدون قطعی به کار خود
          ادامه می‌دهند. از بخش «دسترسی این ربات» می‌توانید مشخص کنید هر ربات به کدام امکانات و کدام
          بازی‌ها دسترسی داشته باشد؛ کتابخانهٔ موزیک بین همهٔ ربات‌ها مشترک است.
        </p>
      </div>

      {error && !showModal && (
        <div className="card bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>
      )}

      <div className="table-container">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">نام</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">یوزرنیم</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">وضعیت</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">دسترسی</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">کاربران</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">کانال‌ها</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">توکن</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bots.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-gray-400">
                  <BotIcon size={48} className="mx-auto mb-3 opacity-30" />
                  <p>رباتی ثبت نشده است</p>
                </td>
              </tr>
            ) : (
              bots.map((bot) => (
                <tr key={bot.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-4 px-6 font-medium text-gray-900">{bot.name}</td>
                  <td className="py-4 px-6">
                    {bot.username ? (
                      <span className="text-blue-600">@{bot.username}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-4 px-6">{statusBadge(bot)}</td>
                  <td className="py-4 px-6">{accessBadge(bot)}</td>
                  <td className="py-4 px-6 text-gray-600">{bot.usersCount.toLocaleString('fa-IR')}</td>
                  <td className="py-4 px-6 text-gray-600">{bot.channelsCount.toLocaleString('fa-IR')}</td>
                  <td className="py-4 px-6">
                    <span className="text-xs text-gray-500 font-mono" dir="ltr">
                      {bot.token.slice(0, 8)}…
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(bot)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="ویرایش / دسترسی‌ها / تغییر توکن"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(bot)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="حذف"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">
                {editing ? `ویرایش ${editing.name}` : 'افزودن ربات جدید'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">نام ربات</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input-field"
                  placeholder="مثلاً ربات فروشگاه"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  توکن ربات (Bot API Token)
                </label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={form.token}
                    onChange={(e) => setForm({ ...form, token: e.target.value })}
                    className="input-field pl-11 font-mono text-sm"
                    placeholder="123456789:AA..."
                    dir="ltr"
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600"
                  >
                    {showToken ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-2 leading-5">
                  توکن را از @BotFather بگیرید. هنگام ذخیره، اعتبار توکن با تلگرام بررسی می‌شود.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">ترتیب نمایش</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                  className="input-field max-w-[140px]"
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="botActive"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <label htmlFor="botActive" className="text-sm text-gray-700">
                  ربات فعال و متصل باشد
                </label>
              </div>

              <div className="border-t border-gray-100 pt-5 space-y-5">
                <div className="flex items-start gap-2">
                  <ShieldCheck size={18} className="text-cyan-600 mt-0.5 shrink-0" />
                  <div>
                    <h3 className="text-base font-bold text-gray-900">دسترسی این ربات</h3>
                    <p className="text-xs text-gray-500 leading-6 mt-1">
                      هر تیک یعنی آن بخش برای این ربات باز است. با برداشتن تیک، دکمهٔ آن از منوی
                      اصلی ربات حذف می‌شود، دستورهای آن از منوی دستورات تلگرام برداشته می‌شود و ورود
                      به آن بخش برای کاربران این ربات بسته می‌شود. تنظیم‌های بخش «تنظیمات» سراسری و
                      برای همهٔ ربات‌هاست؛ این فهرست فقط روی همین ربات عمل می‌کند.
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <Sparkles size={15} className="text-fuchsia-500" />
                    امکانات
                  </p>
                  {renderCheckboxGrid('allowedFeatures', BOT_FEATURE_LABELS, ALL_FEATURE_KEYS)}
                </div>

                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <Gamepad2 size={15} className="text-emerald-500" />
                    بازی‌ها
                  </p>
                  {renderCheckboxGrid('allowedGames', GAME_LABELS, ALL_GAME_KEYS)}
                  <p className="text-xs text-gray-400 leading-5 mt-2">
                    با برداشتن تیک «بازی‌ها» در بخش امکانات، همهٔ بازی‌های این ربات یکجا بسته می‌شود.
                  </p>
                </div>
              </div>

              {error && <p className="text-sm text-red-600 leading-6">{error}</p>}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  {loading ? 'در حال ذخیره...' : editing ? 'ذخیره تغییرات' : 'افزودن ربات'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary flex-1"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
