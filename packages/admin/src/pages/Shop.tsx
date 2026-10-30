import { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Edit, Trash2, ShoppingBag, X, Eye, EyeOff } from 'lucide-react';

type ShopItem = {
  id: number;
  title: string;
  content: string;
  sortOrder: number;
  isActive: boolean;
};

const emptyForm = { title: '', content: '', sortOrder: 0, isActive: true };

export default function Shop() {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ShopItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
    try {
      const res = await axios.get('/api/shop');
      setItems(res.data);
      setError('');
    } catch {
      setError('خطا در بارگذاری فروشگاه');
    }
  };

  const openCreate = () => {
    setEditingItem(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingItem) {
        await axios.put(`/api/shop/${editingItem.id}`, form);
      } else {
        await axios.post('/api/shop', form);
      }
      setShowModal(false);
      setEditingItem(null);
      setForm(emptyForm);
      loadItems();
    } catch (err: any) {
      alert(err.response?.data?.error || 'خطا در ذخیره گزینه فروشگاه');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (item: ShopItem) => {
    setEditingItem(item);
    setForm({
      title: item.title,
      content: item.content,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
    });
    setShowModal(true);
  };

  const toggleActive = async (item: ShopItem) => {
    try {
      await axios.put(`/api/shop/${item.id}`, { ...item, isActive: !item.isActive });
      loadItems();
    } catch {
      alert('خطا در تغییر وضعیت');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('آیا از حذف این گزینه مطمئن هستید؟')) return;
    try {
      await axios.delete(`/api/shop/${id}`);
      loadItems();
    } catch {
      alert('خطا در حذف گزینه');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg">
              <ShoppingBag size={24} className="text-white" />
            </div>
            فروشگاه
          </h1>
          <p className="text-gray-500 mt-2">
            هر گزینه یک دکمه در منوی فروشگاه ربات است؛ متنی که بنویسید بعد از زدن دکمه برای کاربر ارسال می‌شود.
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          افزودن گزینه
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>
      )}

      <div className="table-container">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">عنوان دکمه</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">متن ارسالی</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">ترتیب</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">وضعیت</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-gray-400">
                  <ShoppingBag size={48} className="mx-auto mb-3 opacity-30" />
                  <p>هنوز گزینه‌ای ثبت نشده است</p>
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-4 px-6">
                    <p className="font-medium text-gray-900">{item.title}</p>
                  </td>
                  <td className="py-4 px-6 max-w-md">
                    <p className="text-gray-600 text-sm truncate">{item.content}</p>
                  </td>
                  <td className="py-4 px-6 text-gray-600">{item.sortOrder}</td>
                  <td className="py-4 px-6">
                    <button
                      onClick={() => toggleActive(item)}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
                        item.isActive
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {item.isActive ? <Eye size={12} /> : <EyeOff size={12} />}
                      {item.isActive ? 'فعال' : 'غیرفعال'}
                    </button>
                  </td>
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(item)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
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

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">
                {editingItem ? 'ویرایش گزینه فروشگاه' : 'افزودن گزینه فروشگاه'}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingItem(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">عنوان دکمه</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="input-field"
                  placeholder="مثلاً: خرید اشتراک ویژه"
                  maxLength={64}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  متنی که بعد از زدن دکمه برای کاربر ارسال می‌شود
                </label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className="input-field min-h-[180px] resize-y font-mono text-sm leading-6"
                  placeholder={'متن پیام، قیمت‌ها، لینک‌ها و توضیحات را اینجا بنویسید...\n\nمثال:\nاشتراک یک ماهه: ۱۰۰ هزار تومان\n@support'}
                  maxLength={4000}
                  required
                />
                <p className="text-xs text-gray-400 mt-1">{form.content.length} / 4000 کاراکتر</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">ترتیب نمایش</label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                    className="input-field"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    این گزینه در ربات نمایش داده شود
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-4">
                <button type="submit" disabled={loading} className="btn-primary flex-1 disabled:opacity-50">
                  {loading ? 'در حال ذخیره...' : editingItem ? 'بروزرسانی' : 'افزودن'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingItem(null);
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
