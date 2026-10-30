import { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Edit, Trash2, Shield, X, Loader2, AlertCircle } from 'lucide-react';

interface ProxyForm {
  server: string;
  port: string;
  secret: string;
  isActive: boolean;
}

const emptyForm: ProxyForm = { server: '', port: '', secret: '', isActive: true };

export default function Proxies() {
  const [proxies, setProxies] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingProxy, setEditingProxy] = useState<any>(null);
  const [form, setForm] = useState<ProxyForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadProxies();
  }, []);

  const loadProxies = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('/api/proxy');
      setProxies(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در دریافت پروکسی‌ها');
    } finally {
      setLoading(false);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingProxy(null);
    setForm(emptyForm);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const port = parseInt(form.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError('پورت باید عددی بین ۱ تا ۶۵۵۳۵ باشد');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        server: form.server.trim(),
        port,
        secret: form.secret.trim(),
        isActive: form.isActive,
      };

      if (editingProxy) {
        await axios.put(`/api/proxy/${editingProxy.id}`, payload);
      } else {
        await axios.post('/api/proxy', payload);
      }

      closeModal();
      loadProxies();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ذخیره پروکسی');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (proxy: any) => {
    setEditingProxy(proxy);
    setForm({
      server: proxy.server,
      port: String(proxy.port),
      secret: proxy.secret,
      isActive: proxy.isActive,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('آیا از حذف این پروکسی مطمئن هستید؟')) return;
    try {
      await axios.delete(`/api/proxy/${id}`);
      loadProxies();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در حذف پروکسی');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg">
              <Shield size={24} className="text-white" />
            </div>
            پروکسی‌های MTProto
          </h1>
          <p className="text-gray-500 mt-2">{proxies.length} پروکسی ثبت‌شده</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          افزودن پروکسی
        </button>
      </div>

      {error && !showModal && (
        <div className="card bg-red-50 border-red-200 flex items-center gap-3 text-red-700 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      <div className="table-container">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-3 text-right font-medium">سرور</th>
              <th className="px-4 py-3 text-right font-medium">پورت</th>
              <th className="px-4 py-3 text-right font-medium">Secret</th>
              <th className="px-4 py-3 text-center font-medium">وضعیت</th>
              <th className="px-4 py-3 text-center font-medium">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-400">
                  <Loader2 size={24} className="animate-spin mx-auto" />
                </td>
              </tr>
            ) : proxies.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-400">
                  هنوز پروکسی‌ای ثبت نشده است
                </td>
              </tr>
            ) : (
              proxies.map((proxy) => (
                <tr key={proxy.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-gray-800" dir="ltr">
                    {proxy.server}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{proxy.port}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500" dir="ltr">
                    {proxy.secret.length > 24
                      ? `${proxy.secret.slice(0, 24)}…`
                      : proxy.secret}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                        proxy.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {proxy.isActive ? 'فعال' : 'غیرفعال'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleEdit(proxy)}
                        className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                        title="ویرایش"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(proxy.id)}
                        className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingProxy ? 'ویرایش پروکسی' : 'افزودن پروکسی'}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">سرور</label>
                <input
                  type="text"
                  value={form.server}
                  onChange={(e) => setForm({ ...form, server: e.target.value })}
                  className="input-field"
                  placeholder="example.com"
                  dir="ltr"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">پورت</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  className="input-field"
                  dir="ltr"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Secret</label>
                <input
                  type="text"
                  value={form.secret}
                  onChange={(e) => setForm({ ...form, secret: e.target.value })}
                  className="input-field font-mono text-sm"
                  dir="ltr"
                  required
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">فعال باشد</span>
              </label>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                  ذخیره
                </button>
                <button type="button" onClick={closeModal} className="btn-secondary flex-1">
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
