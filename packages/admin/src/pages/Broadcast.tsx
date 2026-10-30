import { useState, useEffect } from 'react';
import axios from 'axios';
import { Megaphone, Send, Eye, AlertCircle, CheckCircle, Loader2, Users, X } from 'lucide-react';

export default function Broadcast() {
  const [message, setMessage] = useState('');
  const [parseMode, setParseMode] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [previewSent, setPreviewSent] = useState(false);
  const [bots, setBots] = useState<any[]>([]);
  const [botId, setBotId] = useState('');

  useEffect(() => {
    axios
      .get('/api/bots')
      .then((res) => setBots(res.data))
      .catch((err) => console.error('Load bots error:', err));
  }, []);

  const handleSend = async () => {
    if (!message.trim()) {
      setError('لطفاً پیامی وارد کنید');
      return;
    }

    const target = botId
      ? `کاربران «${bots.find((b) => String(b.id) === botId)?.name || 'ربات انتخاب‌شده'}»`
      : 'همه کاربران همه ربات‌ها';

    if (!window.confirm(`آیا از ارسال پیام به ${target} مطمئن هستید؟`)) {
      return;
    }

    setSending(true);
    setError('');
    setResult(null);

    try {
      const res = await axios.post('/api/broadcast', {
        message,
        parseMode: parseMode || undefined,
        botId: botId ? parseInt(botId, 10) : undefined,
      });
      setResult(res.data.stats);
      setMessage('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ارسال پیام');
    } finally {
      setSending(false);
    }
  };

  const handlePreview = async () => {
    if (!message.trim()) {
      setError('لطفاً پیامی وارد کنید');
      return;
    }

    setError('');
    setPreviewSent(false);

    try {
      await axios.post('/api/broadcast/preview', {
        message,
        parseMode: parseMode || undefined,
        botId: botId ? parseInt(botId, 10) : undefined,
      });
      setPreviewSent(true);
      setTimeout(() => setPreviewSent(false), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ارسال پیش‌نمایش');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center shadow-lg">
            <Megaphone size={24} className="text-white" />
          </div>
          پیام همگانی
        </h1>
        <p className="text-gray-500 mt-2">ارسال پیام به تمامی کاربران ربات</p>
      </div>

      {result && (
        <div className="card bg-green-50 border-green-200">
          <div className="flex items-start gap-3">
            <CheckCircle size={24} className="text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-green-800 mb-2">پیام با موفقیت ارسال شد</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-900">{result.total}</p>
                  <p className="text-xs text-gray-500">کل کاربران</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{result.sent}</p>
                  <p className="text-xs text-gray-500">ارسال موفق</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{result.failed}</p>
                  <p className="text-xs text-gray-500">ارسال ناموفق</p>
                </div>
              </div>
              <button
                onClick={() => setResult(null)}
                className="mt-3 text-sm text-green-700 hover:text-green-800 flex items-center gap-1"
              >
                <X size={14} />
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="card bg-red-50 border-red-200 flex items-center gap-3">
          <AlertCircle size={20} className="text-red-600 flex-shrink-0" />
          <p className="text-red-700">{error}</p>
          <button onClick={() => setError('')} className="mr-auto text-red-500 hover:text-red-700">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Users size={20} className="text-purple-500" />
            ارسال پیام جدید
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-purple-500 outline-none"
            >
              <option value="">همه ربات‌ها</option>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                </option>
              ))}
            </select>
            <select
              value={parseMode}
              onChange={(e) => setParseMode(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-purple-500 outline-none"
            >
              <option value="">متن ساده</option>
              <option value="Markdown">Markdown</option>
              <option value="HTML">HTML</option>
            </select>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              متن پیام
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              className="input-field resize-none"
              placeholder="پیام خود را اینجا بنویسید..."
              dir="rtl"
            />
            <p className="text-xs text-gray-400 mt-1">
              {message.length} کاراکتر
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSend}
              disabled={sending || !message.trim()}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  در حال ارسال...
                </>
              ) : (
                <>
                  <Send size={18} />
                  ارسال به {botId ? 'کاربران ربات' : 'همه کاربران'}
                </>
              )}
            </button>
            <button
              onClick={handlePreview}
              disabled={!message.trim()}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              <Eye size={18} />
              پیش‌نمایش
            </button>
            {previewSent && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle size={14} />
                پیش‌نمایش به شما ارسال شد
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="card bg-blue-50 border-blue-200">
        <h3 className="font-bold text-blue-800 mb-2 flex items-center gap-2">
          <AlertCircle size={18} />
          راهنما
        </h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li>پیام به تمام کاربران فعال ربات ارسال می‌شود</li>
          <li>کاربرانی که ربات را بلاک کرده‌اند، پیامی دریافت نمی‌کنند</li>
          <li>پیام‌ها با فاصله ۱ ثانیه‌ای هر ۳۰ پیام ارسال می‌شوند</li>
          <li>برای فرمت‌دهی متن از Markdown یا HTML استفاده کنید</li>
          <li>قبل از ارسال نهایی، از قابلیت پیش‌نمایش استفاده کنید</li>
        </ul>
      </div>
    </div>
  );
}
