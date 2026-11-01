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

const GAME_DEFS = [
  { value: 'TRUTH_OR_DARE', label: '🎭 جرئت و حقیقت', settingKey: 'game_truth_or_dare_enabled' },
  { value: 'TIC_TAC_TOE', label: '❌⭕ دوز', settingKey: 'game_tic_tac_toe_enabled' },
  { value: 'MINESWEEPER', label: '💣 مین‌روب', settingKey: 'game_minesweeper_enabled' },
  { value: 'WORDLE', label: '🔤 کلمه‌یاب', settingKey: 'game_wordle_enabled' },
  { value: 'HOKM', label: '🃏 حکم', settingKey: 'game_hokm_enabled' },
];

// فقط بازی‌هایی که از سوال استفاده می‌کنند در فرم سوال نمایش داده می‌شوند
const FORM_GAME_TYPES = GAME_DEFS.filter((g) => ['TRUTH_OR_DARE', 'WORDLE'].includes(g.value));

export default function Games() {
  const [questions, setQuestions] = useState<GameQuestion[]>([]);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
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
      const [qRes, sRes, setRes] = await Promise.all([
        axios.get("/api/games/questions"),
        axios.get("/api/games/stats"),
        axios.get("/api/settings"),
      ]);
      setQuestions(qRes.data);
      setStats(sRes.data);
      const settingsMap: Record<string, string> = {};
      for (const item of (setRes.data || [])) {
        if (item && item.key) settingsMap[item.key] = item.value;
      }
      setSettings(settingsMap);
    } catch (error) {
      console.error('Load data error:', error);
    }
    setLoading(false);
  }

  async function toggleSetting(key: string, current: boolean) {
    // optimistic update
    setSettings((prev) => ({ ...prev, [key]: current ? 'false' : 'true' }));
    try {
      await axios.put(`/api/settings/${key}`, { value: current ? 'false' : 'true' });
    } catch (error) {
      console.error('Toggle setting error:', error);
      // revert
      setSettings((prev) => ({ ...prev, [key]: current ? 'true' : 'false' }));
      alert('خطا در تغییر وضعیت بازی');
    }
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
      const payload = {
        ...formData,
        answer: formData.gameType === 'WORDLE' ? formData.text.trim() : formData.answer,
        optionA: formData.gameType === 'WORDLE' ? '' : formData.optionA,
        optionB: formData.gameType === 'WORDLE' ? '' : formData.optionB,
        optionC: formData.gameType === 'WORDLE' ? '' : formData.optionC,
        optionD: formData.gameType === 'WORDLE' ? '' : formData.optionD,
      };
      if (editingId) {
        await axios.put(`/api/games/questions/${editingId}`, payload);
      } else {
        await axios.post('/api/games/questions', payload);
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
      await axios.delete(`/api/games/questions/${id}`);
      await loadData();
    } catch (error) {
      console.error('Delete question error:', error);
      alert('خطا در حذف سوال');
    }
  }

  async function toggleActive(id: number, isActive: boolean) {
    try {
      await axios.put(`/api/games/questions/${id}`, { isActive: !isActive });
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
    return GAME_DEFS.find((t) => t.value === type)?.label || type;
  };

  const questionCount = (type: string) =>
    stats?.questionsByType.find((q) => q.type === type)?.count || 0;

  const masterEnabled = settings['games_enabled'] !== 'false';

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

      {/* Game Toggles */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-5 shadow">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            ⚙️ فعال / غیرفعال کردن بازی‌ها
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-300">کل بخش بازی‌ها</span>
            <button
              onClick={() => toggleSetting('games_enabled', masterEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                masterEnabled ? 'bg-green-500' : 'bg-gray-400'
              }`}
              aria-label="فعال/غیرفعال کردن بخش بازی‌ها"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  masterEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {GAME_DEFS.map((game) => {
            const enabled = settings[game.settingKey] === 'true';
            return (
              <div
                key={game.value}
                className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                  enabled
                    ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20'
                    : 'border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-700/30'
                }`}
              >
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {game.label}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {questionCount(game.value)} سوال{!masterEnabled ? ' — کل بخش خاموش' : ''}
                  </div>
                </div>
                <button
                  onClick={() => toggleSetting(game.settingKey, enabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    enabled ? 'bg-green-500' : 'bg-gray-400'
                  }`}
                  aria-label={`فعال/غیرفعال کردن ${game.label}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
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
                {FORM_GAME_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {formData.gameType === 'WORDLE' ? 'کلمه مخفی' : 'متن سوال / چالش'}
              </label>
              <textarea
                value={formData.text}
                onChange={(e) => setFormData({ ...formData, text: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder={
                  formData.gameType === 'WORDLE'
                    ? 'کلمه مخفی را وارد کنید... (طول کلمه = تعداد حروفی که کاربر باید حدس بزند)'
                    : 'سوال یا چالش را وارد کنید...'
                }
              />
              {formData.gameType === 'WORDLE' && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  کلمه‌ی سخت‌تر = طول بیشتر (۶ تا ۹ حرف پیشنهاد می‌شود). حروف عربی ي/ك به‌صورت خودکار به ی/ک تبدیل می‌شوند.
                </p>
              )}
            </div>

            {formData.gameType !== 'WORDLE' && (
              <>
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
                {formData.gameType !== 'TRUTH_OR_DARE' && (
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
                )}
              </>
            )}


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
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === ''
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
          }`}
        >
          همه ({questions.length})
        </button>
        {GAME_DEFS.map((type) => (
          <button
            key={type.value}
            onClick={() => setFilter(type.value)}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === type.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            {type.label} ({questionCount(type.value)})
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
