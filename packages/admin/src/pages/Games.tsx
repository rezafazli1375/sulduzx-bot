import { useState, useEffect } from 'react';
import axios from 'axios';

interface GameQuestion {
  id: number;
  gameType: string;
  text: string;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  answer: string;
  isActive: boolean;
  sortOrder: number;
}

interface GameStats {
  totalQuestions: number;
  activeSessions: number;
  questionsByType: { type: string; count: number }[];
  finishedByType: { type: string; count: number }[];
}

const GAME_TYPES = [
  { value: 'TRUTH_OR_DARE', label: '🎭 جرعت و حقیقت' },
  { value: 'TIC_TAC_TOE', label: '❌⭕ دوز' },
  { value: 'MINESWEEPER', label: '💣 پیدا کردن بمب' },
];

export default function Games() {
  const [questions, setQuestions] = useState<GameQuestion[]>([]);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState({
    gameType: 'TRUTH_OR_DARE',
    text: '',
    optionA: '',
    optionB: '',
    optionC: '',
    optionD: '',
    answer: 'A',
    sortOrder: 0,
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [qRes, sRes] = await Promise.all([
        axios.get("/api/games/questions"),
        axios.get("/api/games/stats"),
      ]);
      setQuestions(qRes.data);
      setStats(sRes.data);
    } catch (error) {
      console.error('Load data error:', error);
    }
    setLoading(false);
  }

  function resetForm() {
    setFormData({
      gameType: 'TRUTH_OR_DARE',
        text: '',
      optionA: '',
      optionB: '',
      optionC: '',
      optionD: '',
      answer: 'A',
      sortOrder: 0,
    });
    setEditingId(null);
    setShowForm(false);
  }

  function editQuestion(q: GameQuestion) {
    setFormData({
      gameType: q.gameType,
      text: q.text,
      optionA: q.optionA || '',
      optionB: q.optionB || '',
      optionC: q.optionC || '',
      optionD: q.optionD || '',
      answer: q.answer,
      sortOrder: q.sortOrder,
    });
    setEditingId(q.id);
    setShowForm(true);
  }

  async function saveQuestion() {
    try {
      if (editingId) {
        await axios.put(`/games/questions/${editingId}`, formData);
      } else {
        await axios.post('/games/questions', formData);
      }
      resetForm();
      await loadData();
    } catch (error) {
      console.error('Save question error:', error);
      alert('خطا در ذخیره سوال');
    }
  }

  async function deleteQuestion(id: number) {
    if (!confirm('آیا از حذف این سوال مطمئن هستید؟')) return;
    try {
      await axios.delete(`/games/questions/${id}`);
      await loadData();
    } catch (error) {
      console.error('Delete question error:', error);
      alert('خطا در حذف سوال');
    }
  }

  async function toggleActive(id: number, isActive: boolean) {
    try {
      await axios.put(`/games/questions/${id}`, { isActive: !isActive });
      await loadData();
    } catch (error) {
      console.error('Toggle active error:', error);
    }
  }

  const filteredQuestions = questions.filter((q) => {
    if (filter && q.gameType !== filter) return false;
    return true;
  });

  const gameTypeLabel = (type: string) => {
    return GAME_TYPES.find((t) => t.value === type)?.label || type;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🎮 مدیریت بازی‌ها</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showForm ? '❌ بستن فرم' : '➕ سوال جدید'}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
            <div className="text-sm text-gray-500 dark:text-gray-400">کل سوالات</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalQuestions}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
            <div className="text-sm text-gray-500 dark:text-gray-400">بازی‌های فعال (۲۴ ساعت)</div>
            <div className="text-2xl font-bold text-green-600">{stats.activeSessions}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
            <div className="text-sm text-gray-500 dark:text-gray-400">سوالات فعال</div>
            <div className="text-2xl font-bold text-blue-600">
              {stats.questionsByType.reduce((sum, q) => sum + q.count, 0)}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
            <div className="text-sm text-gray-500 dark:text-gray-400">بازی‌های تمام‌شده</div>
            <div className="text-2xl font-bold text-purple-600">
              {stats.finishedByType.reduce((sum, s) => sum + s.count, 0)}
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
            {editingId ? 'ویرایش سوال' : 'سوال جدید'}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                نوع بازی
              </label>
              <select
                value={formData.gameType}
                onChange={(e) => setFormData({ ...formData, gameType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {GAME_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                متن سوال / چالش
              </label>
              <textarea
                value={formData.text}
                onChange={(e) => setFormData({ ...formData, text: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="سوال یا چالش را وارد کنید..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      گزینه A
                    </label>
                    <input
                      type="text"
                      value={formData.optionA}
                      onChange={(e) => setFormData({ ...formData, optionA: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      گزینه B
                    </label>
                    <input
                      type="text"
                      value={formData.optionB}
                      onChange={(e) => setFormData({ ...formData, optionB: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      گزینه C
                    </label>
                    <input
                      type="text"
                      value={formData.optionC}
                      onChange={(e) => setFormData({ ...formData, optionC: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      گزینه D
                    </label>
                    <input
                      type="text"
                      value={formData.optionD}
                      onChange={(e) => setFormData({ ...formData, optionD: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    جواب صحیح
                  </label>
                  <select
                    value={formData.answer}
                    onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="A">گزینه A</option>
                    <option value="B">گزینه B</option>
                    <option value="C">گزینه C</option>
                    <option value="D">گزینه D</option>
                  </select>
                </div>


            {formData.gameType === 'TRUTH_OR_DARE' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  نوع
                </label>
                <select
                  value={formData.answer}
                  onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="truth">💬 حقیقت (سوال)</option>
                  <option value="dare">💪 جرئت (چالش)</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                ترتیب نمایش
              </label>
              <input
                type="number"
                value={formData.sortOrder}
                onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={saveQuestion}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                {editingId ? '💾 ذخیره تغییرات' : '➕ افزودن'}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                ❌ انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter('')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === ''
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
          }`}
        >
          همه
        </button>
        {GAME_TYPES.map((type) => (
          <button
            key={type.value}
            onClick={() => setFilter(type.value)}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === type.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            {type.label}
          </button>
        ))}
      </div>

      {/* Questions List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  نوع
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  متن
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  وضعیت
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  عملیات
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredQuestions.map((q) => (
                <tr key={q.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                    {gameTypeLabel(q.gameType)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 max-w-md truncate">
                    {q.text}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => toggleActive(q.id, q.isActive)}
                      className={`px-2 py-1 rounded text-xs ${
                        q.isActive
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      }`}
                    >
                      {q.isActive ? 'فعال' : 'غیرفعال'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <button
                        onClick={() => editQuestion(q)}
                        className="px-2 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded text-xs hover:bg-blue-200"
                      >
                        ویرایش
                      </button>
                      <button
                        onClick={() => deleteQuestion(q.id)}
                        className="px-2 py-1 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded text-xs hover:bg-red-200"
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredQuestions.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            هیچ سوالی یافت نشد.
          </div>
        )}
      </div>
    </div>
  );
}
