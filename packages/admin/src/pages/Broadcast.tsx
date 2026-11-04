import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Megaphone,
  Send,
  Eye,
  AlertCircle,
  CheckCircle,
  Loader2,
  Users,
  X,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  ListChecks,
} from 'lucide-react';
import { formatDateTime } from '../lib/features';

type Target = 'users' | 'groups';

export default function Broadcast() {
  const [message, setMessage] = useState('');
  const [parseMode, setParseMode] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [groupResult, setGroupResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [previewSent, setPreviewSent] = useState(false);
  const [bots, setBots] = useState<any[]>([]);
  const [botId, setBotId] = useState('');
  const [target, setTarget] = useState<Target>('users');

  const [groups, setGroups] = useState<any[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    axios
      .get('/api/bots')
      .then((res) => setBots(res.data))
      .catch((err) => console.error('Load bots error:', err));
  }, []);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const res = await axios.get('/api/broadcast/groups', {
        params: botId ? { botId } : undefined,
      });
      setGroups(res.data.groups ?? []);
    } catch (err: any) {
      console.error('Load groups error:', err);
      setGroups([]);
    } finally {
      setGroupsLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    if (target === 'groups') loadGroups();
  }, [target, loadGroups]);

  const toggleGroup = (chatId: string) => {
    setSelected((prev) =>
      prev.includes(chatId) ? prev.filter((id) => id !== chatId) : [...prev, chatId]
    );
  };

  const selectAll = () => setSelected(groups.map((g) => String(g.chatId)));
  const selectNone = () => setSelected([]);

  const handleSend = async () => {
    if (!message.trim()) {
      setError('لطفاً پیامی وارد کنید');
      return;
    }

    const targetName = botId
      ? `کاربران «${bots.find((b) => String(b.id) === botId)?.name || 'ربات انتخاب‌شده'}»`
      : 'همه کاربران همه ربات‌ها';

    if (!window.confirm(`آیا از ارسال پیام به ${targetName} مطمئن هستید؟`)) {
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

  const handleSendGroups = async () => {
    if (!message.trim()) {
      setError('لطفاً پیامی وارد کنید');
      return;
    }
    if (groups.length === 0) {
      setError('هنوز گروهی ثبت نشده است');
      return;
    }

    const count = selected.length > 0 ? selected.length : groups.length;
    const label = selected.length > 0 ? `${count} گروه انتخاب‌شده` : `همه ${count} گروه`;

    if (!window.confirm(`پیام به ${label} ارسال شود؟`)) return;

    setSending(true);
    setError('');
    setGroupResult(null);

    try {
      const res = await axios.post('/api/broadcast/groups', {
        message,
        parseMode: parseMode || undefined,
        botId: botId ? parseInt(botId, 10) : undefined,
        chatIds: selected.length > 0 ? selected : undefined,
      });
      setGroupResult(res.data.stats);
      setMessage('');
      setSelected([]);
      loadGroups();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ارسال پیام به گروه‌ها');
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

  const tabs: { key: Target; label: string; icon: typeof Users }[] = [
    { key: 'users', label: 'ارسال پیام به کاربران', icon: Users },
    { key: 'groups', label: 'ارسال پیام به گروه‌ها', icon: MessageSquare },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center shadow-lg">
            <Megaphone size={24} className="text-white" />
          </div>
          پیام همگانی
        </h1>
        <p className="text-gray-500 mt-2">
          ارسال پیام به کاربران ربات یا به گروه‌هایی که ربات در آن‌ها عضو است
        </p>
      </div>

      {/* انتخاب مخاطب */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = target === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setTarget(tab.key)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                active
                  ? 'bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow-lg'
                  : 'card text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon size={18} />
              {tab.label}
            </button>
          );
        })}
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

      {groupResult && (
        <div className="card bg-green-50 border-green-200">
          <div className="flex items-start gap-3">
            <CheckCircle size={24} className="text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-green-800 mb-2">ارسال پیام به گروه‌ها انجام شد</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-900">{groupResult.total}</p>
                  <p className="text-xs text-gray-500">کل گروه‌ها</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{groupResult.sent}</p>
                  <p className="text-xs text-gray-500">ارسال موفق</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{groupResult.failed}</p>
                  <p className="text-xs text-gray-500">ارسال ناموفق</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{groupResult.left}</p>
                  <p className="text-xs text-gray-500">ربات عضو نیست</p>
                </div>
              </div>
              <button
                onClick={() => setGroupResult(null)}
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

          <div className="flex flex-wrap items-center gap-3 pt-2">
            {target === 'users' ? (
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
            ) : (
              <button
                onClick={handleSendGroups}
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
                    ارسال به{' '}
                    {selected.length > 0
                      ? `${selected.length} گروه`
                      : `همه ${groups.length} گروه`}
                  </>
                )}
              </button>
            )}
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
            {sending && target === 'groups' && (
              <span className="text-sm text-gray-500">در حال ارسال، لحظاتی صبر کنید...</span>
            )}
          </div>
        </div>
      </div>

      {/* بخش ارسال پیام به گروه‌ها */}
      {target === 'groups' && (
        <div className="card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <ListChecks size={20} className="text-purple-500" />
              گروه‌های عضو ربات
              <span className="text-sm font-normal text-gray-500">({groups.length} گروه)</span>
            </h2>
            <div className="flex items-center gap-2">
              <button onClick={selectAll} className="btn-secondary text-sm py-1.5">
                انتخاب همه
              </button>
              <button onClick={selectNone} className="btn-secondary text-sm py-1.5">
                حذف انتخاب‌ها
              </button>
              <button
                onClick={loadGroups}
                className="btn-secondary text-sm py-1.5 flex items-center gap-1"
              >
                <RefreshCw size={14} className={groupsLoading ? 'animate-spin' : ''} />
                بروزرسانی
              </button>
            </div>
          </div>

          {groupsLoading && groups.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">در حال دریافت گروه‌ها...</p>
          ) : groups.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
              هنوز گروهی ثبت نشده است. به محض اینکه ربات در گروهی پیامی دریافت کند یا به گروهی
              اضافه شود، آن گروه در این لیست نمایش داده می‌شود.
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {groups.map((g) => {
                const checked = selected.includes(String(g.chatId));
                return (
                  <label
                    key={g.chatId}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition ${
                      checked ? 'bg-purple-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGroup(String(g.chatId))}
                      className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-gray-900 truncate">
                        {g.title || 'گروه بدون نام'}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {g.username ? `@${g.username} · ` : ''}
                        شناسه: <span dir="ltr">{g.chatId}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {typeof g.memberCount === 'number' && g.memberCount > 0 && (
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Users size={12} />
                          {g.memberCount}
                        </span>
                      )}
                      {!g.botIsAdmin && (
                        <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 flex items-center gap-1">
                          <ShieldAlert size={12} />
                          ادمین نیست
                        </span>
                      )}
                      <span className="text-xs text-gray-400 hidden sm:block">
                        {formatDateTime(g.lastSeenAt)}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="card bg-blue-50 border-blue-200">
        <h3 className="font-bold text-blue-800 mb-2 flex items-center gap-2">
          <AlertCircle size={18} />
          راهنما
        </h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          {target === 'users' ? (
            <>
              <li>پیام به تمام کاربران فعال ربات ارسال می‌شود</li>
              <li>کاربرانی که ربات را بلاک کرده‌اند، پیامی دریافت نمی‌کنند</li>
              <li>پیام‌ها با فاصله ۱ ثانیه‌ای هر ۳۰ پیام ارسال می‌شوند</li>
            </>
          ) : (
            <>
              <li>فقط گروه‌هایی که ربات در آن‌ها عضو است نمایش داده می‌شود</li>
              <li>اگر هیچ گروهی تیک نخورده باشد، پیام به همه گروه‌های لیست ارسال می‌شود</li>
              <li>گروه‌هایی که ربات از آن‌ها خارج شده باشد خودکار از لیست حذف می‌شوند</li>
              <li>برای جلوگیری از محدودیت تلگرام، هر ۲۰ پیام یک ثانیه توقف دارد</li>
            </>
          )}
          <li>برای فرمت‌دهی متن از Markdown یا HTML استفاده کنید</li>
          <li>قبل از ارسال نهایی، از قابلیت پیش‌نمایش استفاده کنید</li>
        </ul>
      </div>
    </div>
  );
}
