import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, LayoutGrid, Info, ArrowUp, ArrowDown } from 'lucide-react';

type MenuButton = {
  id: number;
  key: string;
  label: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
};

const COLORS = [
  { value: 'none', label: 'بدون رنگ' },
  { value: 'red', label: 'قرمز' },
  { value: 'orange', label: 'نارنجی' },
  { value: 'yellow', label: 'زرد' },
  { value: 'green', label: 'سبز' },
  { value: 'blue', label: 'آبی' },
  { value: 'purple', label: 'بنفش' },
];

export default function Menu() {
  const [buttons, setButtons] = useState<MenuButton[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadButtons();
  }, []);

  const loadButtons = async () => {
    try {
      const res = await axios.get('/api/menu');
      setButtons(res.data);
    } catch {
      setError('خطا در بارگذاری منوی ربات');
    }
  };

  const update = (id: number, patch: Partial<MenuButton>) => {
    setButtons(buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= buttons.length) return;
    const next = [...buttons];
    [next[index], next[target]] = [next[target], next[index]];
    setButtons(next.map((b, i) => ({ ...b, sortOrder: (i + 1) * 10 })));
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.put('/api/menu/batch', { buttons });
      setButtons(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ذخیره منو');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
              <LayoutGrid size={24} className="text-white" />
            </div>
            منوی ربات
          </h1>
          <p className="text-gray-500 mt-2">
            ترتیب، عنوان، رنگ و فعال/غیرفعال بودن دکمه‌های منوی اصلی ربات
          </p>
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
          تلگرام امکان تغییر رنگ واقعی دکمه‌های Inline را نمی‌دهد؛ به همین دلیل رنگ انتخابی به‌صورت یک
          نقطه رنگی (🔴🟠🟡🟢🔵🟣) ابتدای عنوان دکمه نمایش داده می‌شود. دکمه‌ها در ربات به‌صورت دو
          ستونه چیده می‌شوند.
        </p>
      </div>

      {saved && (
        <div className="card bg-green-50 border-green-200 text-green-700 text-sm">
          منو با موفقیت ذخیره شد
        </div>
      )}

      {error && <div className="card bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>}

      <div className="table-container">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">جابجایی</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">عنوان دکمه</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">رنگ</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">ترتیب</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">وضعیت</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {buttons.map((button, index) => (
              <tr key={button.id} className="hover:bg-gray-50 transition-colors">
                <td className="py-4 px-6">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="p-1.5 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-30"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === buttons.length - 1}
                      className="p-1.5 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-30"
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                </td>
                <td className="py-4 px-6">
                  <input
                    type="text"
                    value={button.label}
                    onChange={(e) => update(button.id, { label: e.target.value })}
                    className="input-field max-w-xs"
                    maxLength={64}
                  />
                  <p className="text-xs text-gray-400 mt-1 font-mono">{button.key}</p>
                </td>
                <td className="py-4 px-6">
                  <select
                    value={button.color}
                    onChange={(e) => update(button.id, { color: e.target.value })}
                    className="input-field max-w-[140px]"
                  >
                    {COLORS.map((color) => (
                      <option key={color.value} value={color.value}>
                        {color.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-4 px-6">
                  <input
                    type="number"
                    value={button.sortOrder}
                    onChange={(e) => update(button.id, { sortOrder: parseInt(e.target.value) || 0 })}
                    className="input-field max-w-[110px]"
                  />
                </td>
                <td className="py-4 px-6">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={button.isActive}
                      onChange={(e) => update(button.id, { isActive: e.target.checked })}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    نمایش در ربات
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
