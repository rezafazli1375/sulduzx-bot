import { useState, useEffect } from 'react';
import axios from 'axios';

interface GameQuestion {
  id: number;
  gameType: string;
  text: string;
  /** دستهٔ محتوای سؤال جرعت و حقیقت: 'sfw' = معمولی (−۱۸)، 'nsfw' = بزرگ‌سالان (+۱۸) */
  category: string;
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
  truthOrDareByCategory?: { category: string; count: number }[];
  finishedByType: { type: string; count: number }[];
}

// از نسخهٔ ۲٫۰٫۰ فقط همین سه بازی در ربات می‌مانند.
const GAME_DEFS = [
  { value: 'TRUTH_OR_DARE', label: '🎭 جرعت و حقیقت', settingKey: 'game_truth_or_dare_enabled' },
  { value: 'TIC_TAC_TOE', label: '❌⭕ دوز', settingKey: 'game_tic_tac_toe_enabled' },
  { value: 'MINESWEEPER', label: '💣 مین‌روب', settingKey: 'game_minesweeper_enabled' },
];

/**
 * نوع‌های قدیمی که بازی‌شان حذف شده است. سطرهای موجود در جدول پاک نمی‌شوند
 * (دادهٔ مالک دست‌نخورده می‌ماند) ولی برچسبشان نشان می‌دهد دیگر استفاده
 * نمی‌شوند و در فهرست «همه» قابل حذف هستند.
 */
const REMOVED_GAME_TYPES: Record<string, string> = {
  WORDLE: '🔤 کلمه‌یاب (حذف‌شده)',
  HOKM: '🃏 حکم (حذف‌شده)',
  MENCH: '🎲 منچ (حذف‌شده)',
  SCALA: '🇮🇹 اسکالا (حذف‌شده)',
};

/** تنها بازیِ سؤال‌محور — بقیهٔ دو بازی تخته‌ای‌اند و سؤالی نمی‌خواهند */
const FORM_GAME_TYPES = GAME_DEFS.filter((g) => g.value === 'TRUTH_OR_DARE');

const CATEGORY_LABELS: Record<string, string> = {
  sfw: '🙈 معمولی (−۱۸)',
  nsfw: '🔞 بزرگ‌سالان (+۱۸)',
};

const CATEGORY_FILTERS = [
  { value: '', label: 'همهٔ دسته‌ها' },
  { value: 'sfw', label: CATEGORY_LABELS.sfw },
  { value: 'nsfw', label: CATEGORY_LABELS.nsfw },
];

export default function Games() {
  const [questions, setQuestions] = useState<GameQuestion[]>([]);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
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
    answer: 'truth',
    category: 'sfw',
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
      answer: 'truth',
      category: 'sfw',
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
      category: q.category || 'sfw',
      sortOrder: q.sortOrder,
    });
    setEditingId(q.id);
    setShowForm(true);
  }

  async function saveQuestion() {
    if (!isQuestionFormEditable) return;
    try {
      // سؤال جرعت و حقیقت فقط دو چیز اضافه می‌خواهد: نوع (حقیقت/جرئت) و دسته (−۱۸/+۱۸)
      const payload = {
        gameType: formData.gameType,
        text: formData.text.trim(),
        answer: formData.answer,
        category: formData.category,
        sortOrder: formData.sortOrder,
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
    if (categoryFilter && (q.category || 'sfw') !== categoryFilter) return false;
    return true;
  });

  function gameTypeLabel(type: string) {
    return GAME_DEFS.find((t) => t.value === type)?.label || REMOVED_GAME_TYPES[type] || type;
  }

  const questionCount = (type: string) =>
    stats?.questionsByType.find((q) => q.type === type)?.count || 0;

  const todCategoryCount = (category: string) =>
    stats?.truthOrDareByCategory?.find((c) => c.category === category)?.count || 0;

  const nsfwSettingOn = settings['game_truth_or_dare_nsfw'] !== 'false';
  const privatePlayOn = settings['games_private_vs_bot_enabled'] !== 'false';

  /** سطرهای بازیهایی که حذف شده‌اند فقط از جدول قابل غیرفعال/حذف کردن هستند */
  const isQuestionFormEditable = formData.gameType === 'TRUTH_OR_DARE';

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

        {/* دو کلید تازهٔ نسخهٔ ۲٫۰٫۰: بازی در پیوی مقابل ربات، و دستهٔ +۱۸ */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            className={`flex items-center justify-between rounded-lg border p-3 ${
              privatePlayOn
                ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20'
                : 'border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-700/30'
            }`}
          >
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                🤖 بازی در پیوی با خودِ ربات
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 leading-6">
                دوز و مین‌روب مقابل ربات و جرعت و حقیقتِ تک‌نفره در گفتگوی خصوصی؛ خاموش یعنی فقط در گروه
              </div>
            </div>
            <button
              onClick={() => toggleSetting('games_private_vs_bot_enabled', privatePlayOn)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                privatePlayOn ? 'bg-green-500' : 'bg-gray-400'
              }`}
              aria-label="فعال/غیرفعال کردن بازی در پیوی"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  privatePlayOn ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div
            className={`flex items-center justify-between rounded-lg border p-3 ${
              nsfwSettingOn
                ? 'border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/20'
                : 'border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-700/30'
            }`}
          >
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                🔞 دستهٔ «بزرگ‌سالان (+۱۸)» در جرعت و حقیقت
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 leading-6">
                {todCategoryCount('nsfw')} سؤال +۱۸ ثبت‌شده — خاموش یعنی ربات فقط سؤال‌های «معمولی (−۱۸)» را
                می‌پرسد، حتی اگر بازیکن دستهٔ +۱۸ را انتخاب کند
              </div>
            </div>
            <button
              onClick={() => toggleSetting('game_truth_or_dare_nsfw', nsfwSettingOn)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                nsfwSettingOn ? 'bg-rose-500' : 'bg-gray-400'
              }`}
              aria-label="فعال/غیرفعال کردن دستهٔ +۱۸"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  nsfwSettingOn ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
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
                بازی
              </label>
              <select
                value={formData.gameType}
                onChange={(e) => setFormData({ ...formData, gameType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {(isQuestionFormEditable
                  ? FORM_GAME_TYPES
                  : [
                      ...FORM_GAME_TYPES,
                      {
                        value: formData.gameType,
                        label: gameTypeLabel(formData.gameType),
                        settingKey: '',
                      },
                    ]
                ).map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                از نسخهٔ ۲٫۰٫۰ فقط جرعت و حقیقت سؤال می‌خواهد؛ دوز و مین‌روب تخته‌ای‌اند.
              </p>
            </div>

            {!isQuestionFormEditable && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 leading-6">
                این سوال مربوط به بازی‌ای است که در نسخهٔ ۲٫۰٫۰ حذف شده، پس برای ویرایش باز نشد. با
                دکمهٔ «غیرفعال/حذف» در جدول مدیریتش کنید.
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                متن سوال / چالش
              </label>
              <textarea
                value={formData.text}
                onChange={(e) => setFormData({ ...formData, text: e.target.value })}
                rows={3}
                disabled={!isQuestionFormEditable}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-60"
                placeholder="مثلاً: آخرین باری که صادقانه عذرخواهی کردی کِی بود؟"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  نوع
                </label>
                <select
                  value={formData.answer}
                  onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                  disabled={!isQuestionFormEditable}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-60"
                >
                  <option value="truth">💬 حقیقت (سوال)</option>
                  <option value="dare">💪 جرئت (چالش)</option>
                </select>
              </div>

              {/* دستهٔ محتوا — نسخهٔ ۲٫۰٫۰ */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  دستهٔ محتوا
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  disabled={!isQuestionFormEditable}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-60"
                >
                  <option value="sfw">{CATEGORY_LABELS.sfw}</option>
                  <option value="nsfw">{CATEGORY_LABELS.nsfw}</option>
                </select>
                {formData.category === 'nsfw' && !nsfwSettingOn && (
                  <p className="mt-1 text-xs text-rose-700">
                    ⚠️ دستهٔ «+۱۸» در بالا خاموش است، پس این سوال هرگز پرسیده نمی‌شود.
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                ترتیب نمایش
              </label>
              <input
                type="number"
                value={formData.sortOrder}
                onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                disabled={!isQuestionFormEditable}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white max-w-xs disabled:opacity-60"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={saveQuestion}
                disabled={!isQuestionFormEditable || !formData.text.trim()}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
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
          onClick={() => {
            setFilter('');
            setCategoryFilter('');
          }}
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
            onClick={() => {
              setFilter(type.value);
              setCategoryFilter('');
            }}
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

      {/* فیلتر دستهٔ محتوا — فقط برای جرعت و حقیقت (+۱۸ / −۱۸) */}
      {(filter === '' || filter === 'TRUTH_OR_DARE') && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            دستهٔ محتوا:
          </span>
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat.value || 'all'}
              onClick={() => setCategoryFilter(cat.value)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                categoryFilter === cat.value
                  ? 'bg-rose-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              {cat.label}
              {cat.value ? ` (${todCategoryCount(cat.value)})` : ''}
            </button>
          ))}
          {!nsfwSettingOn && (
            <span className="text-xs text-rose-700">
              ⚠️ دستهٔ «+۱۸» در بخش تنظیمات بازی خاموش است.
            </span>
          )}
        </div>
      )}

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
                  دسته
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
                  <td className="px-4 py-3 text-sm">
                    {q.gameType === 'TRUTH_OR_DARE' ? (
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          (q.category || 'sfw') === 'nsfw'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {CATEGORY_LABELS[q.category || 'sfw'] || CATEGORY_LABELS.sfw}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
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
