import { useState, useEffect } from 'react';
import axios from 'axios';
import { Bot as BotIcon, Plus, Edit, Trash2, X, Info, Eye, EyeOff, CircleCheck, CircleX, CirclePause } from 'lucide-react';

type BotRow = {
  id: number;
  name: string;
  token: string;
  username: string | null;
  isActive: boolean;
  sortOrder: number;
  usersCount: number;
  channelsCount: number;
  runtime: { running: boolean; username?: string; error?: string };
};

const emptyForm = { name: '', token: '', isActive: true, sortOrder: 50 };

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
    setForm(emptyForm);
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
    });
    setShowToken(false);
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (editing) {
        await axios.put(`/api/bots/${editing.id}`, form);
      } else {
        await axios.post('/api/bots', form);
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
          <p className="text-gray-500 mt-2">مدیریت توکن و وضعیت ربات‌های تلگرامی متصل به سامانه</p>
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
          ادامه می‌دهند.
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
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">کاربران</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">کانال‌ها</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">توکن</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bots.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400">
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
                        title="ویرایش / تغییر توکن"
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
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

              {error && <p className="text-sm text-red-600 leading-6">{error}</p>}

              <div className="flex items-center gap-3 pt-2">
                <button type="submit" disabled={loading} className="btn-primary flex-1 disabled:opacity-50">
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
