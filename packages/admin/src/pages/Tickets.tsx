import { useState, useEffect } from 'react';
import axios from 'axios';
import { MessageSquare, Ticket as TicketIcon, X, Send, Loader2, AlertCircle } from 'lucide-react';

const statusStyles: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  RESOLVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-gray-100 text-gray-600',
};

const statusLabels: Record<string, string> = {
  OPEN: 'باز',
  IN_PROGRESS: 'در حال بررسی',
  RESOLVED: 'پاسخ داده شده',
  CLOSED: 'بسته',
};

export default function Tickets() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTickets();
  }, [page]);

  const loadTickets = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('/api/tickets', { params: { page, limit: 20 } });
      setTickets(res.data.tickets);
      setTotal(res.data.total);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در دریافت تیکت‌ها');
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  const handleReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    setError('');
    try {
      await axios.put(`/api/tickets/${selectedTicket.id}`, {
        status: 'RESOLVED',
        adminReply: reply.trim(),
      });
      setSelectedTicket(null);
      setReply('');
      loadTickets();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ارسال پاسخ');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center shadow-lg">
            <TicketIcon size={24} className="text-white" />
          </div>
          تیکت‌ها
        </h1>
        <p className="text-gray-500 mt-2">{total} تیکت پشتیبانی</p>
      </div>

      {error && (
        <div className="card bg-red-50 border-red-200 flex items-center gap-3 text-red-700 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      <div className="table-container">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-3 text-right font-medium">شماره</th>
              <th className="px-4 py-3 text-right font-medium">کاربر</th>
              <th className="px-4 py-3 text-right font-medium">پیام</th>
              <th className="px-4 py-3 text-center font-medium">وضعیت</th>
              <th className="px-4 py-3 text-center font-medium">تاریخ</th>
              <th className="px-4 py-3 text-center font-medium">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400">
                  <Loader2 size={24} className="animate-spin mx-auto" />
                </td>
              </tr>
            ) : tickets.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400">
                  تیکتی ثبت نشده است
                </td>
              </tr>
            ) : (
              tickets.map((ticket) => (
                <tr key={ticket.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-700">#{ticket.id}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">
                      {ticket.user?.firstName || ticket.user?.username || '---'}
                    </p>
                    <p className="text-xs text-gray-500" dir="ltr">
                      {ticket.user?.telegramId}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                    {ticket.message}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                        statusStyles[ticket.status] || statusStyles.CLOSED
                      }`}
                    >
                      {statusLabels[ticket.status] || ticket.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-500">
                    {new Date(ticket.createdAt).toLocaleDateString('fa-IR')}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => {
                        setSelectedTicket(ticket);
                        setReply(ticket.adminReply || '');
                      }}
                      className="mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      <MessageSquare size={14} />
                      {ticket.adminReply ? 'مشاهده' : 'پاسخ'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            قبلی
          </button>
          <span className="text-sm text-gray-600">
            صفحه {page} از {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages}
            className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            بعدی
          </button>
        </div>
      )}

      {selectedTicket && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                تیکت #{selectedTicket.id}
              </h2>
              <button
                onClick={() => {
                  setSelectedTicket(null);
                  setReply('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">
                    {selectedTicket.user?.firstName || selectedTicket.user?.username || '---'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(selectedTicket.createdAt).toLocaleString('fa-IR')}
                  </span>
                </div>
                <p className="text-gray-700 leading-7 whitespace-pre-wrap">
                  {selectedTicket.message}
                </p>
              </div>

              {selectedTicket.adminReply && (
                <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                  <p className="text-xs font-medium text-green-700 mb-1">پاسخ قبلی</p>
                  <p className="text-green-800 leading-7 whitespace-pre-wrap">
                    {selectedTicket.adminReply}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  پاسخ شما
                </label>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="پاسخ خود را بنویسید..."
                  rows={5}
                  className="input-field resize-none"
                />
                <p className="text-xs text-gray-400 mt-1">
                  این پاسخ از طریق ربات تلگرام برای کاربر ارسال می‌شود.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleReply}
                  disabled={sending || !reply.trim()}
                  className="btn-success flex-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      در حال ارسال...
                    </>
                  ) : (
                    <>
                      <Send size={16} />
                      ارسال پاسخ
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setSelectedTicket(null);
                    setReply('');
                  }}
                  className="btn-secondary flex-1"
                >
                  انصراف
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
