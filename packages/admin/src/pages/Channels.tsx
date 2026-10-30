import { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Edit, Trash2, Radio, X } from 'lucide-react';

const emptyForm = {
  botId: '',
  channelId: '',
  channelUsername: '',
  title: '',
  isRequired: true,
  joinOrder: 0,
};

export default function Channels() {
  const [channels, setChannels] = useState<any[]>([]);
  const [bots, setBots] = useState<any[]>([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<any>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBots();
  }, []);

  useEffect(() => {
    loadChannels();
  }, [selectedBotId]);

  const loadBots = async () => {
    try {
      const res = await axios.get('/api/bots');
      setBots(res.data);
      if (res.data.length > 0) {
        setForm((f: any) => (f.botId ? f : { ...f, botId: String(res.data[0].id) }));
      }
    } catch (error) {
      console.error('Load bots error:', error);
    }
  };

  const loadChannels = async () => {
    const url = selectedBotId ? `/api/channels?botId=${selectedBotId}` : '/api/channels';
    const res = await axios.get(url);
    setChannels(res.data);
  };

  const openCreate = () => {
    setEditingChannel(null);
    setForm({
      ...emptyForm,
      botId: selectedBotId || (bots[0] ? String(bots[0].id) : ''),
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingChannel) {
        const payload = {
          channelId: form.channelId,
          channelUsername: form.channelUsername,
          title: form.title,
          isRequired: form.isRequired,
          joinOrder: form.joinOrder,
        };
        await axios.put(`/api/channels/${editingChannel.id}`, payload);
      } else {
        await axios.post('/api/channels', { ...form, botId: parseInt(form.botId, 10) });
      }
      setShowModal(false);
      setEditingChannel(null);
      setForm(emptyForm);
      loadChannels();
    } catch (error: any) {
      console.error('Submit error:', error);
      alert(error.response?.data?.error || 'خطا در ذخیره کانال');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (channel: any) => {
    setEditingChannel(channel);
    setForm({
      botId: String(channel.botId),
      channelId: channel.channelId.toString(),
      channelUsername: channel.channelUsername,
      title: channel.title || '',
      isRequired: channel.isRequired,
      joinOrder: channel.joinOrder,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('آیا از حذف این کانال مطمئن هستید؟')) return;
    await axios.delete(`/api/channels/${id}`);
    loadChannels();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <Radio size={24} className="text-white" />
            </div>
            کانال‌ها
          </h1>
          <p className="text-gray-500 mt-2">کانال‌های عضویت اجباری، جدا برای هر ربات</p>
        </div>
        <button
          onClick={openCreate}
          disabled={bots.length === 0}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          <Plus size={18} />
          افزودن کانال
        </button>
      </div>

      <div className="card flex items-center gap-4 flex-wrap">
        <label className="text-sm font-medium text-gray-700">ربات:</label>
        <select
          value={selectedBotId}
          onChange={(e) => setSelectedBotId(e.target.value)}
          className="input-field max-w-xs"
        >
          <option value="">همه ربات‌ها</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
              {bot.username ? ` (@${bot.username})` : ''}
            </option>
          ))}
        </select>
        {bots.length === 0 && (
          <span className="text-sm text-amber-600">
            ابتدا از صفحه «ربات‌ها» یک ربات اضافه کنید.
          </span>
        )}
      </div>

      <div className="table-container">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">ربات</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">عنوان</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">یوزرنیم</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">عضویت اجباری</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">ترتیب</th>
              <th className="text-right py-4 px-6 text-sm font-semibold text-gray-600">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {channels.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-gray-400">
                  <Radio size={48} className="mx-auto mb-3 opacity-30" />
                  <p>کانالی ثبت نشده است</p>
                </td>
              </tr>
            ) : (
              channels.map((channel) => (
                <tr key={channel.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-4 px-6">
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                      {channel.bot?.name || `ربات #${channel.botId}`}
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    <p className="font-medium text-gray-900">{channel.title || 'بدون عنوان'}</p>
                  </td>
                  <td className="py-4 px-6">
                    <span className="text-blue-600">
                      @{String(channel.channelUsername).replace(/^@/, '')}
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      channel.isRequired
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {channel.isRequired ? 'اجباری' : 'اختیاری'}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-gray-600">{channel.joinOrder}</td>
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(channel)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(channel.id)}
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">
                {editingChannel ? 'ویرایش کانال' : 'افزودن کانال جدید'}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingChannel(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">ربات</label>
                <select
                  value={form.botId}
                  onChange={(e) => setForm({ ...form, botId: e.target.value })}
                  className="input-field"
                  disabled={!!editingChannel}
                  required
                >
                  <option value="" disabled>
                    انتخاب ربات
                  </option>
                  {bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>
                      {bot.name}
                      {bot.username ? ` (@${bot.username})` : ''}
                    </option>
                  ))}
                </select>
                {editingChannel && (
                  <p className="text-xs text-gray-400 mt-2">ربات یک کانال قابل تغییر نیست.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  شناسه کانال (Channel ID)
                </label>
                <input
                  type="text"
                  value={form.channelId}
                  onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                  className="input-field"
                  placeholder="-1001234567890"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  یوزرنیم کانال
                </label>
                <input
                  type="text"
                  value={form.channelUsername}
                  onChange={(e) => setForm({ ...form, channelUsername: e.target.value.replace('@', '') })}
                  className="input-field"
                  placeholder="channel_username"
                  required
                />
                <p className="text-xs text-gray-400 mt-2">
                  ربات انتخاب‌شده باید ادمین کانال باشد تا بتواند عضویت را بررسی کند.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  عنوان کانال
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="input-field"
                  placeholder="عنوان نمایشی کانال"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ترتیب نمایش
                </label>
                <input
                  type="number"
                  value={form.joinOrder}
                  onChange={(e) => setForm({ ...form, joinOrder: parseInt(e.target.value) })}
                  className="input-field max-w-xs"
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isRequired"
                  checked={form.isRequired}
                  onChange={(e) => setForm({ ...form, isRequired: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <label htmlFor="isRequired" className="text-sm text-gray-700">
                  عضویت در این کانال اجباری است
                </label>
              </div>
              <div className="flex items-center gap-3 pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  {loading ? 'در حال ذخیره...' : editingChannel ? 'بروزرسانی' : 'افزودن'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingChannel(null);
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
