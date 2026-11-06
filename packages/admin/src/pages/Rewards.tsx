import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Plus, Edit, Trash2, Gift, X, Eye, EyeOff, Undo2 } from 'lucide-react';

type Reward = {
  id: number;
  title: string;
  subtitle: string | null;
  costPoints: number;
  dataGb: number;
  days: number;
  limitIp: number;
  inboundId: number | null;
  maxPerUser: number | null;
  stock: number | null;
  isActive: boolean;
  sortOrder: number;
  issued: number;
};

type Redemption = {
  id: number;
  email: string;
  costPoints: number;
  dataGb: number;
  days: number;
  status: 'PENDING' | 'ISSUED' | 'FAILED' | 'REFUNDED';
  failReason: string | null;
  createdAt: string;
  reward: { id: number; title: string } | null;
  user: { id: number; telegramId: string; username: string | null; firstName: string | null; points: number } | null;
};

type Form = {
  title: string;
  subtitle: string;
  costPoints: string;
  dataGb: string;
  days: string;
  limitIp: string;
  inboundId: string;
  maxPerUser: string;
  stock: string;
  sortOrder: string;
  isActive: boolean;
};

const EMPTY: Form = {
  title: '',
  subtitle: '',
  costPoints: '100',
  dataGb: '1',
  days: '7',
  limitIp: '2',
  inboundId: '',
  maxPerUser: '',
  stock: '',
  sortOrder: '0',
  isActive: true,
};

const STATUS_LABEL: Record<Redemption['status'], string> = {
  PENDING: 'در حال صدور',
  ISSUED: 'صادر شد',
  FAILED: 'ناموفق',
  REFUNDED: 'برگشت خورد',
};

const STATUS_STYLE: Record<Redemption['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  ISSUED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
  REFUNDED: 'bg-gray-200 text-gray-600',
};

const num = (value: string) => (value.trim() === '' ? null : Number(value));

function toForm(reward: Reward): Form {
  return {
    title: reward.title,
    subtitle: reward.subtitle ?? '',
    costPoints: String(reward.costPoints),
    dataGb: String(reward.dataGb),
    days: String(reward.days),
    limitIp: String(reward.limitIp),
    inboundId: reward.inboundId === null ? '' : String(reward.inboundId),
    maxPerUser: reward.maxPerUser === null ? '' : String(reward.maxPerUser),
    stock: reward.stock === null ? '' : String(reward.stock),
    sortOrder: String(reward.sortOrder),
    isActive: reward.isActive,
  };
}

function toPayload(form: Form) {
  return {
    title: form.title.trim(),
    subtitle: form.subtitle.trim(),
    costPoints: Number(form.costPoints),
    dataGb: Number(form.dataGb),
    days: Number(form.days),
    limitIp: Number(form.limitIp || 2),
    inboundId: num(form.inboundId),
    maxPerUser: num(form.maxPerUser),
    stock: num(form.stock),
    sortOrder: Number(form.sortOrder || 0),
    isActive: form.isActive,
  };
}

export default function Rewards() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([axios.get('/api/rewards'), axios.get('/api/rewards/redemptions', { params: { limit: 50 } })]);
      setRewards(r.data);
      setRedemptions(d.data);
      setError('');
    } catch {
      setError('خطا در بارگذاری پاداش‌ها');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setShowModal(true);
  };

  const openEdit = (reward: Reward) => {
    setEditingId(reward.id);
    setForm(toForm(reward));
    setShowModal(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = toPayload(form);
      if (editingId === null) await axios.post('/api/rewards', payload);
      else await axios.put(`/api/rewards/${editingId}`, payload);
      setShowModal(false);
      setEditingId(null);
      setForm(EMPTY);
      await load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'خطا در ذخیرهٔ پاداش');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (reward: Reward) => {
    try {
      await axios.put(`/api/rewards/${reward.id}`, { ...toPayload(toForm(reward)), isActive: !reward.isActive });
      await load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'خطا در تغییر وضعیت');
    }
  };

  const remove = async (reward: Reward) => {
    if (!window.confirm(`«${reward.title}» حذف شود؟ خرج‌های قبلی پاک نمی‌شوند.`)) return;
    try {
      await axios.delete(`/api/rewards/${reward.id}`);
      await load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'خطا در حذف');
    }
  };

  const revoke = async (row: Redemption) => {
    if (!window.confirm(`بازگردانی این خروج؟\n\nکلاینت ${row.email} از پنل حذف و ${row.costPoints} امتیاز به کاربر برگردانده می‌شود.`)) return;
    try {
      await axios.post(`/api/rewards/redemptions/${row.id}/revoke`, { reason: 'تصمیم مدیر از صفحهٔ پاداش‌ها' });
      await load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'خطا در بازگردانی');
    }
  };

  const totalIssued = rewards.reduce((sum, r) => sum + (r.issued || 0), 0);
  const pointsSpent = redemptions
    .filter((r) => r.status === 'ISSUED')
    .reduce((sum, r) => sum + r.costPoints, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-fuchsia-600 rounded-xl flex items-center justify-center shadow-lg">
              <Gift size={24} className="text-white" />
            </div>
            پاداش‌های امتیازی
          </h1>
          <p className="text-gray-500 mt-2">
            هر پاداش یعنی «چند امتیاز ← چند گیگ و چند روز». کاربر از بخش امتیازهای ربات خودش خرج می‌کند و کانفیگ می‌گیرد.
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          افزودن پاداش
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500">پاداش‌های فعال</p>
          <p className="text-2xl font-bold text-gray-900">{rewards.filter((r) => r.isActive).length}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">کانفیگ صادرشده با امتیاز</p>
          <p className="text-2xl font-bold text-gray-900">{totalIssued}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">امتیاز خرج‌شده (۵۰ خروج آخر)</p>
          <p className="text-2xl font-bold text-gray-900">{pointsSpent}</p>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>}

      <div className="table-container">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">پاداش</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">تبدیل</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">موجودی</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">سقف هر کاربر</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">گرفته‌اند</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">وضعیت</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rewards.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400">
                  <Gift size={48} className="mx-auto mb-3 opacity-30" />
                  <p>هنوز پاداشی تعریف نشده است</p>
                </td>
              </tr>
            ) : (
              rewards.map((reward) => (
                <tr key={reward.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-4 px-6">
                    <p className="font-medium text-gray-900">{reward.title}</p>
                    {reward.subtitle && <p className="text-xs text-gray-500 mt-1">{reward.subtitle}</p>}
                  </td>
                  <td className="py-4 px-6 text-gray-700">
                    {reward.costPoints} امتیاز ← {reward.dataGb} گیگ / {reward.days} روز
                  </td>
                  <td className="py-4 px-6 text-gray-700">{reward.stock === null ? 'نامحدود' : reward.stock}</td>
                  <td className="py-4 px-6 text-gray-700">{reward.maxPerUser === null ? '—' : reward.maxPerUser}</td>
                  <td className="py-4 px-6 text-gray-700">{reward.issued}</td>
                  <td className="py-4 px-6">
                    <button
                      onClick={() => toggleActive(reward)}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
                        reward.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {reward.isActive ? <Eye size={12} /> : <EyeOff size={12} />}
                      {reward.isActive ? 'فعال' : 'غیرفعال'}
                    </button>
                  </td>
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(reward)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => remove(reward)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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

      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-3">آخرین خرج‌ها</h2>
        <div className="table-container">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-right py-3 px-6 text-sm font-semibold text-gray-600">کاربر</th>
                <th className="text-right py-3 px-6 text-sm font-semibold text-gray-600">پاداش</th>
                <th className="text-right py-3 px-6 text-sm font-semibold text-gray-600">امتیاز</th>
                <th className="text-right py-3 px-6 text-sm font-semibold text-gray-600">حجم / زمان</th>
                <th className="text-right py-3 px-6 text-sm font-semibold text-gray-600">کلاینت</th>
                <th className="text-right py-3 px-6 text-sm font-semibold text-gray-600">وضعیت</th>
                <th className="text-right py-3 px-6 text-sm font-semibold text-gray-600">زمان</th>
                <th className="text-right py-3 px-6 text-sm font-semibold text-gray-600">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {redemptions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-gray-400">
                    هنوز کسی امتیازی خرج نکرده است
                  </td>
                </tr>
              ) : (
                redemptions.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-6">
                      <p className="font-medium text-gray-900">
                        {row.user?.username || row.user?.firstName || '—'}
                      </p>
                      <p className="text-xs text-gray-500">{row.user?.telegramId ?? '—'}</p>
                    </td>
                    <td className="py-3 px-6 text-gray-700">{row.reward?.title ?? 'حذف‌شده'}</td>
                    <td className="py-3 px-6 text-gray-700">{row.costPoints}</td>
                    <td className="py-3 px-6 text-gray-700">
                      {row.dataGb} گیگ / {row.days} روز
                    </td>
                    <td className="py-3 px-6 text-gray-500 text-xs font-mono" dir="ltr">
                      {row.email}
                    </td>
                    <td className="py-3 px-6">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${STATUS_STYLE[row.status]}`}>
                        {STATUS_LABEL[row.status]}
                      </span>
                      {row.failReason && (
                        <p className="text-xs text-gray-500 mt-1 max-w-xs truncate" title={row.failReason}>
                          {row.failReason}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-6 text-gray-600 text-xs">{new Date(row.createdAt).toLocaleString('fa-IR')}</td>
                    <td className="py-3 px-6">
                      {row.status === 'ISSUED' ? (
                        <button
                          onClick={() => revoke(row)}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors"
                        >
                          <Undo2 size={14} />
                          بازگردانی
                        </button>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">
                {editingId === null ? 'افزودن پاداش' : 'ویرایش پاداش'}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingId(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={submit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">عنوان پاداش</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="input-field"
                  placeholder="مثلاً: بستهٔ ۱ گیگی"
                  maxLength={64}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">توضیح کوتاه (اختیاری)</label>
                <input
                  type="text"
                  value={form.subtitle}
                  onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                  className="input-field"
                  placeholder="مثلاً: برای تست سرعت سرورها"
                  maxLength={300}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">هزینه (امتیاز)</label>
                  <input
                    type="number"
                    value={form.costPoints}
                    onChange={(e) => setForm({ ...form, costPoints: e.target.value })}
                    className="input-field"
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">حجم (گیگ)</label>
                  <input
                    type="number"
                    step="0.05"
                    value={form.dataGb}
                    onChange={(e) => setForm({ ...form, dataGb: e.target.value })}
                    className="input-field"
                    min="0.05"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">مدت (روز)</label>
                  <input
                    type="number"
                    value={form.days}
                    onChange={(e) => setForm({ ...form, days: e.target.value })}
                    className="input-field"
                    min="1"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">محدودیت IP</label>
                  <input
                    type="number"
                    value={form.limitIp}
                    onChange={(e) => setForm({ ...form, limitIp: e.target.value })}
                    className="input-field"
                    min="0"
                    max="10"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">شمارهٔ اینباند (خالی = پیش‌فرض)</label>
                  <input
                    type="number"
                    value={form.inboundId}
                    onChange={(e) => setForm({ ...form, inboundId: e.target.value })}
                    className="input-field"
                    min="1"
                    placeholder="مثلاً ۱۱"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">موجودی (خالی = نامحدود)</label>
                  <input
                    type="number"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    className="input-field"
                    min="0"
                    placeholder="مثلاً ۲۰"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">سقف هر کاربر (خالی = نه)</label>
                  <input
                    type="number"
                    value={form.maxPerUser}
                    onChange={(e) => setForm({ ...form, maxPerUser: e.target.value })}
                    className="input-field"
                    min="1"
                    placeholder="مثلاً ۱"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">ترتیب نمایش</label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                این پاداش در ربات نمایش داده شود
              </label>

              <div className="flex items-center gap-3 pt-4">
                <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-50">
                  {saving ? 'در حال ذخیره...' : editingId === null ? 'افزودن' : 'بروزرسانی'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingId(null);
                  }}
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
