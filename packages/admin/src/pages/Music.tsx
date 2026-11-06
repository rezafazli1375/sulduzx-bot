import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Music as MusicIcon,
  Upload,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Loader2,
  X,
  PlayCircle,
  PauseCircle,
  Music2,
  Headphones,
  AlarmClock,
  Plus,
  Pencil,
} from 'lucide-react';
import { formatDateTime } from '../lib/features';
import VoiceCallPanel from '../components/VoiceCallPanel';

const MAX_UPLOAD_MB = 20;

/** منطقهٔ زمانیِ ساعت‌هایی که مدیر وارد می‌کند (با سرور یکی نیست) */
const SCHEDULE_TZ = 'Asia/Tehran';

/** هفتهٔ ایرانی از شنبه؛ عدد = همان Date.getDay() (۰=یکشنبه … ۶=شنبه) */
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 6, label: 'شنبه' },
  { value: 0, label: 'یکشنبه' },
  { value: 1, label: 'دوشنبه' },
  { value: 2, label: 'سه‌شنبه' },
  { value: 3, label: 'چهارشنبه' },
  { value: 4, label: 'پنج‌شنبه' },
  { value: 5, label: 'جمعه' },
];

const KIND_LABELS: Record<string, string> = {
  daily: 'روزهای هفته و ساعت',
  interval: 'هر چند دقیقه یک‌بار',
  once: 'فقط یک بار',
};

interface ScheduleForm {
  id: number | null;
  name: string;
  botId: string;
  kind: 'daily' | 'interval' | 'once';
  times: string[];
  days: number[];
  intervalMinutes: string;
  onceAt: string;
  chatIds: string[];
  isActive: boolean;
}

const EMPTY_FORM: ScheduleForm = {
  id: null,
  name: '',
  botId: '',
  kind: 'daily',
  times: [],
  days: [],
  intervalMinutes: '180',
  onceAt: '',
  chatIds: [],
  isActive: true,
};

/** «HH:MM» به وقت تهران برای input نوع datetime-local */
function toWallClockInput(value?: string | Date | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: SCHEDULE_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
    return parts.replace(' ', 'T').slice(0, 16);
  } catch {
    return '';
  }
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} مگابایت`;
  return `${Math.max(1, Math.round(bytes / 1024))} کیلوبایت`;
}

const SOURCE_LABEL: Record<string, string> = {
  panel: 'آپلود پنل',
  group: 'ارسالی کاربر',
};

export default function Music() {
  const [tracks, setTracks] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [playTrackId, setPlayTrackId] = useState('');
  const [playChatId, setPlayChatId] = useState('');
  const [bots, setBots] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM);
  const [timeInput, setTimeInput] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [preview, setPreview] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes, groupsRes, botsRes, schedulesRes] = await Promise.all([
        axios.get('/api/music'),
        axios.get('/api/music/stats'),
        axios.get('/api/music/groups'),
        axios.get('/api/bots'),
        axios.get('/api/music/schedules'),
      ]);
      setTracks(listRes.data.tracks ?? []);
      setStats(statsRes.data);
      setGroups(groupsRes.data.groups ?? []);
      setBots((botsRes.data ?? []).filter((bot: any) => bot.isActive));
      setSchedules(schedulesRes.data.schedules ?? []);
      setError('');
    } catch (err: any) {
      console.error('Load music error:', err);
      setError(err.response?.data?.error || 'خطا در دریافت اطلاعات موزیک');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 4000);
  };

  const handleUpload = async () => {
    setError('');
    if (!file) {
      setError('فایل آهنگ را انتخاب کنید');
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`حجم فایل باید کمتر از ${MAX_UPLOAD_MB} مگابایت باشد`);
      return;
    }

    setUploading(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('خواندن فایل ناموفق بود'));
        reader.readAsDataURL(file);
      });

      await axios.post('/api/music', {
        title: title.trim() || file.name,
        artist: artist.trim() || undefined,
        fileName: file.name,
        mimeType: file.type || undefined,
        dataBase64,
      });

      setTitle('');
      setArtist('');
      setFile(null);
      const input = document.getElementById('music-file') as HTMLInputElement | null;
      if (input) input.value = '';
      flash('✅ آهنگ به کتابخانهٔ مشترک اضافه شد');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در آپلود آهنگ');
    } finally {
      setUploading(false);
    }
  };

  const toggleActive = async (track: any) => {
    try {
      await axios.patch(`/api/music/${track.id}`, { isActive: !track.isActive });
      flash(track.isActive ? '🔇 آهنگ غیرفعال شد' : '🔊 آهنگ فعال شد');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در تغییر وضعیت آهنگ');
    }
  };

  const removeTrack = async (track: any) => {
    if (!window.confirm(`«${track.title}» حذف شود؟ پیام‌های پخش‌شدهٔ این آهنگ هم از گزارش می‌روند.`)) {
      return;
    }
    try {
      const res = await axios.delete(`/api/music/${track.id}`);
      flash(res.data?.removedFile ? '🗑 آهنگ و فایلش حذف شد' : '🗑 آهنگ حذف شد');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در حذف آهنگ');
    }
  };

  /** پخش آزمایشی: همان کاری که دستور /play در گروه می‌کند، ولی با آهنگ دلخواه */
  const handlePlay = async () => {
    setError('');
    if (!playTrackId || !playChatId) {
      setError('هم آهنگ و هم گروه را انتخاب کنید');
      return;
    }
    setPlaying(true);
    try {
      await axios.post(`/api/music/${playTrackId}/play`, { chatId: playChatId });
      const track = tracks.find((item) => String(item.id) === playTrackId);
      flash(`✅ «${track?.title || 'آهنگ'}» به‌شکل ویس در گروه فرستاده شد`);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'پخش آهنگ در گروه ناموفق بود');
    } finally {
      setPlaying(false);
    }
  };

  // ─── پخش خودکار (زمان‌بندی) ────────────────
  const patchForm = (changes: Partial<ScheduleForm>) => setForm((prev) => ({ ...prev, ...changes }));

  /** گروه‌هایی که برای ربات انتخاب‌شده ثبت شده‌اند */
  const formGroups = form.botId
    ? groups.filter((group) => String(group.botId) === String(form.botId))
    : [];

  const addTime = () => {
    const clock = timeInput.trim();
    if (!/^\d{2}:\d{2}$/.test(clock)) {
      setError('ساعت را به شکل HH:MM انتخاب کنید');
      return;
    }
    if (form.times.includes(clock)) {
      setTimeInput('');
      return;
    }
    if (form.times.length >= 8) {
      setError('حداکثر ۸ ساعت برای هر زمان‌بندی');
      return;
    }
    patchForm({ times: [...form.times, clock].sort() });
    setTimeInput('');
    setPreview(null);
  };

  const toggleDay = (day: number) => {
    const days = form.days.includes(day) ? form.days.filter((item) => item !== day) : [...form.days, day];
    patchForm({ days: days.sort() });
    setPreview(null);
  };

  const toggleGroup = (chatId: string) => {
    const chatIds = form.chatIds.includes(chatId)
      ? form.chatIds.filter((item) => item !== chatId)
      : [...form.chatIds, chatId];
    patchForm({ chatIds });
  };

  const schedulePayload = () => ({
    name: form.name.trim(),
    botId: Number(form.botId),
    chatIds: form.chatIds,
    kind: form.kind,
    times: form.kind === 'daily' ? form.times : [],
    days: form.kind === 'daily' ? form.days : [],
    intervalMinutes: form.kind === 'interval' ? Number(form.intervalMinutes) : undefined,
    onceAt: form.kind === 'once' ? form.onceAt : undefined,
    timezone: SCHEDULE_TZ,
    isActive: form.isActive,
  });

  const previewSchedule = async () => {
    setError('');
    if (form.kind === 'daily' && form.times.length === 0) {
      setError('اول یک ساعت اضافه کنید');
      return;
    }
    if (form.kind === 'once' && !form.onceAt) {
      setError('تاریخ و ساعت را وارد کنید');
      return;
    }
    try {
      const res = await axios.post('/api/music/schedules/preview', schedulePayload());
      setPreview(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'پیش‌نمایش ساعت بعدی ناموفق بود');
    }
  };

  const saveSchedule = async () => {
    setError('');
    if (!form.botId) {
      setError('ربات را انتخاب کنید');
      return;
    }
    if (form.chatIds.length === 0) {
      setError('حداقل یک گروه را تیک بزنید');
      return;
    }
    if (form.kind === 'daily' && form.times.length === 0) {
      setError('حداقل یک ساعت اضافه کنید');
      return;
    }
    if (form.kind === 'once' && !form.onceAt) {
      setError('تاریخ و ساعت ارسال را وارد کنید');
      return;
    }

    setSavingSchedule(true);
    try {
      if (form.id) {
        await axios.patch(`/api/music/schedules/${form.id}`, schedulePayload());
        flash(`✅ زمان‌بندی «${form.name.trim() || 'بدون نام'}» به‌روز شد`);
      } else {
        await axios.post('/api/music/schedules', schedulePayload());
        flash(`✅ زمان‌بندی «${form.name.trim() || 'بدون نام'}» ساخته شد`);
      }
      setForm(EMPTY_FORM);
      setPreview(null);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ذخیرهٔ زمان‌بندی ناموفق بود');
    } finally {
      setSavingSchedule(false);
    }
  };

  const editSchedule = (row: any) => {
    setForm({
      id: row.id,
      name: row.name || '',
      botId: String(row.botId),
      kind: row.kind,
      times: row.times ?? [],
      days: row.days ?? [],
      intervalMinutes: String(row.intervalMinutes ?? 180),
      onceAt: toWallClockInput(row.onceAt),
      chatIds: row.chatIds ?? [],
      isActive: !!row.isActive,
    });
    setPreview(null);
    document.getElementById('music-schedule-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const removeSchedule = async (row: any) => {
    if (!window.confirm(`زمان‌بندی «${row.name || row.label}» حذف شود؟`)) return;
    try {
      await axios.delete(`/api/music/schedules/${row.id}`);
      if (form.id === row.id) setForm(EMPTY_FORM);
      flash('🗑 زمان‌بندی حذف شد');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'حذف زمان‌بندی ناموفق بود');
    }
  };

  const toggleScheduleActive = async (row: any) => {
    try {
      await axios.patch(`/api/music/schedules/${row.id}`, { isActive: !row.isActive });
      flash(row.isActive ? '⏸ زمان‌بندی خاموش شد' : '▶️ زمان‌بندی روشن شد');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'تغییر وضعیت زمان‌بندی ناموفق بود');
    }
  };

  /** همین حالا یک آهنگ تصادفی در گروه‌های این زمان‌بندی فرستاده می‌شود */
  const runSchedule = async (row: any) => {
    setError('');
    setRunningId(row.id);
    try {
      const res = await axios.post(`/api/music/schedules/${row.id}/run`);
      const summary = res.data?.report?.summary || '';
      if (res.data?.success) flash(`✅ ${summary}`);
      else setError(`❌ ${summary || 'ارسال ناموفق بود'}`);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'اجرای زمان‌بندی ناموفق بود');
    } finally {
      setRunningId(null);
    }
  };

  const statCards = [
    { label: 'کل آهنگ‌ها', value: stats?.totalTracks ?? 0, icon: Music2 },
    { label: 'آهنگ‌های فعال', value: stats?.activeTracks ?? 0, icon: Headphones },
    { label: 'کل پخش‌ها', value: stats?.totalPlays ?? 0, icon: PlayCircle },
    { label: 'پخش امروز', value: stats?.playsToday ?? 0, icon: MusicIcon },
  ];

  const activeTracks = tracks.filter((track) => track.isActive);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-fuchsia-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <MusicIcon size={24} className="text-white" />
            </div>
            موزیک
          </h1>
          <p className="text-gray-500 mt-2">
            کتابخانهٔ مشترک آهنگ‌ها — همهٔ ربات‌های ثبت‌شده از همین فهرست پخش می‌کنند
          </p>
        </div>
        <button
          onClick={load}
          className="btn-secondary flex items-center gap-2"
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          بروزرسانی
        </button>
      </div>

      {/* آمار */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="card flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-fuchsia-50 flex items-center justify-center shrink-0">
                <Icon size={20} className="text-fuchsia-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                <p className="text-xs text-gray-500">{card.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* در حال پخش */}
      <div className="card">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
          <PlayCircle size={20} className="text-red-500" />
          در حال پخش
          <span className="text-sm font-normal text-gray-500">
            ({stats?.nowPlayingCount ?? 0} گروه)
          </span>
        </h2>
        {(stats?.nowPlaying ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">هم‌اکنون آهنگی در هیچ گروهی پخش نمی‌شود.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="text-right font-medium py-2">آهنگ</th>
                  <th className="text-right font-medium py-2">گروه</th>
                  <th className="text-right font-medium py-2">ربات</th>
                  <th className="text-right font-medium py-2">درخواست‌کننده</th>
                  <th className="text-right font-medium py-2">شروع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.nowPlaying.map((play: any) => (
                  <tr key={play.id}>
                    <td className="py-2.5 font-bold text-gray-900">
                      🎵 {play.title}
                      {play.artist ? <span className="text-gray-500 font-normal"> — {play.artist}</span> : null}
                    </td>
                    <td className="py-2.5 text-gray-700">{play.groupTitle}</td>
                    <td className="py-2.5 text-gray-700">{play.botName || `#${play.botId}`}</td>
                    <td className="py-2.5 text-gray-700">{play.requestName || '—'}</td>
                    <td className="py-2.5 text-gray-500">{formatDateTime(play.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {notice && (
        <div className="card bg-green-50 border-green-200 flex items-center gap-3">
          <CheckCircle size={20} className="text-green-600 flex-shrink-0" />
          <p className="text-green-700">{notice}</p>
          <button onClick={() => setNotice('')} className="mr-auto text-green-600">
            <X size={16} />
          </button>
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

      {/* آپلود */}
      <div className="card">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
          <Upload size={20} className="text-fuchsia-500" />
          افزودن آهنگ به کتابخانهٔ مشترک
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">نام آهنگ</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-field"
              placeholder="مثلاً: سولدوز - شب بارانی"
              dir="rtl"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">خواننده (اختیاری)</label>
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="input-field"
              placeholder="نام هنرمند"
              dir="rtl"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              فایل آهنگ (mp3 تا {MAX_UPLOAD_MB} مگابایت)
            </label>
            <input
              id="music-file"
              type="file"
              accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.flac,.wav"
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                setFile(chosen);
                if (chosen && !title.trim()) setTitle(chosen.name.replace(/\.[a-z0-9]{2,4}$/i, ''));
              }}
              className="block w-full text-sm text-gray-600 file:ml-3 file:rounded-lg file:border-0 file:bg-fuchsia-50 file:px-4 file:py-2 file:text-fuchsia-700"
            />
            {file && (
              <p className="text-xs text-gray-500 mt-1">
                {file.name} — {formatSize(file.size)}
              </p>
            )}
          </div>
          <div className="md:col-span-3">
            <button
              onClick={handleUpload}
              disabled={uploading || !file}
              className="btn-primary w-full md:w-auto flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  در حال آپلود...
                </>
              ) : (
                <>
                  <Upload size={18} />
                  افزودن به کتابخانه
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* پخش در گروه */}
      <div className="card" id="music-play-card">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-2">
          <PlayCircle size={20} className="text-fuchsia-500" />
          پخش در گروه
        </h2>
        <p className="text-xs text-gray-500 mb-4 leading-6">
          آهنگ انتخابی به‌شکل <b>ویس</b> در گروه فرستاده می‌شود؛ خط اول کپشن نام آهنگ و خط دوم
          آیدی خودِ ربات است. پیام متنی یا دکمه‌ای اضافه نمی‌شود.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">آهنگ</label>
            <select
              value={playTrackId}
              onChange={(e) => setPlayTrackId(e.target.value)}
              className="input-field"
            >
              <option value="">انتخاب آهنگ…</option>
              {activeTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.title}
                  {track.artist ? ` — ${track.artist}` : ''}
                  {track.hasLocalFile ? '' : ' (فایل نیست)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">گروه</label>
            <select
              value={playChatId}
              onChange={(e) => setPlayChatId(e.target.value)}
              className="input-field"
            >
              <option value="">انتخاب گروه…</option>
              {groups.map((group) => (
                <option key={`${group.botId}:${group.chatId}`} value={group.chatId}>
                  {group.title || group.chatId}
                  {group.botName ? ` — ${group.botName}` : ''}
                  {group.memberCount ? ` (${group.memberCount} عضو)` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={handlePlay}
              disabled={playing || !playTrackId || !playChatId}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {playing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  در حال پخش...
                </>
              ) : (
                <>
                  <PlayCircle size={18} />
                  ارسال ویس در گروه
                </>
              )}
            </button>
          </div>
        </div>
        {groups.length === 0 && (
          <p className="text-xs text-amber-700 mt-3">
            گروهی در دسترس نیست؛ ربات باید حداقل یک پیام از گروه ببیند (مثلاً با /start در گروه
            یا افزودن ربات به گروه) تا اینجا بیاید.
          </p>
        )}
      </div>

      {/* رادیوی ویس‌کال: حساب تلگرام عادی + پخش تصادفی در گروه */}
      <VoiceCallPanel groups={groups} onNotice={flash} />

      {/* زمان‌بندی پخش خودکار — فرم */}
      <div className="card" id="music-schedule-card">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-2">
          <AlarmClock size={20} className="text-fuchsia-500" />
          پخش خودکار در ساعت تعیین‌شده
        </h2>
        <p className="text-xs text-gray-500 mb-4 leading-6">
          برای هر ربات یک برنامه بگذارید: در هر زمان مقرر، <b>یک آهنگ تصادفی</b> از کتابخانهٔ مشترک
          به‌شکل <b>ویس</b> — با همان کپشن همیشگی (خط اول نام آهنگ، خط دوم آیدی ربات) — در گروه‌هایی
          که تیک زده‌اید فرستاده می‌شود. ساعت‌ها <b>به وقت تهران</b> است و پیام متنی یا دکمه‌ای اضافه
          نمی‌شود.
        </p>

        {form.id !== null && (
          <div className="mb-4 flex items-center justify-between rounded-lg bg-fuchsia-50 border border-fuchsia-200 px-3 py-2">
            <p className="text-sm text-fuchsia-800">
              در حال ویرایش زمان‌بندی «{form.name || 'بدون نام'}»
            </p>
            <button
              onClick={() => {
                setForm(EMPTY_FORM);
                setPreview(null);
              }}
              className="btn-secondary text-xs py-1"
            >
              انصراف از ویرایش
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">نام زمان‌بندی (اختیاری)</label>
            <input
              value={form.name}
              onChange={(e) => patchForm({ name: e.target.value })}
              className="input-field"
              placeholder="مثلاً: آهنگ شب بخیر"
              dir="rtl"
              maxLength={64}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">ربات</label>
            <select
              value={form.botId}
              onChange={(e) => {
                patchForm({ botId: e.target.value, chatIds: [] });
                setPreview(null);
              }}
              className="input-field"
            >
              <option value="">انتخاب ربات…</option>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                  {bot.username ? ` (@${bot.username})` : ''}
                </option>
              ))}
            </select>
            {bots.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">ربات فعالی ثبت نشده است.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">نوع زمان‌بندی</label>
            <select
              value={form.kind}
              onChange={(e) => {
                patchForm({ kind: e.target.value as ScheduleForm['kind'] });
                setPreview(null);
              }}
              className="input-field"
            >
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={() => patchForm({ isActive: !form.isActive })}
                className="w-4 h-4 text-fuchsia-600 rounded border-gray-300 focus:ring-fuchsia-500"
              />
              روشن باشد
            </label>
          </div>
        </div>

        {form.kind === 'daily' && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">ساعت‌ها (HH:MM به وقت تهران)</label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                  className="input-field"
                  dir="ltr"
                />
                <button onClick={addTime} className="btn-secondary flex items-center gap-1 whitespace-nowrap">
                  <Plus size={16} />
                  افزودن ساعت
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {form.times.length === 0 ? (
                  <p className="text-xs text-gray-500">هنوز ساعتی اضافه نشده است.</p>
                ) : (
                  form.times.map((clock) => (
                    <button
                      key={clock}
                      onClick={() => patchForm({ times: form.times.filter((item) => item !== clock) })}
                      className="flex items-center gap-1 rounded-lg bg-fuchsia-50 border border-fuchsia-200 px-2.5 py-1 text-sm text-fuchsia-800"
                      title="حذف این ساعت"
                      dir="ltr"
                    >
                      {clock}
                      <X size={14} />
                    </button>
                  ))
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                روزها (اگر هیچ‌کدام تیک نباشد: هر روز)
              </label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => {
                  const checked = form.days.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      onClick={() => toggleDay(day.value)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                        checked
                          ? 'bg-fuchsia-600 border-fuchsia-600 text-white'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-fuchsia-300'
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {form.days.length === 0
                  ? 'هر روز ارسال می‌شود.'
                  : `فقط در: ${WEEKDAYS.filter((day) => form.days.includes(day.value))
                      .map((day) => day.label)
                      .join('، ')}`}
              </p>
            </div>
          </div>
        )}

        {form.kind === 'interval' && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              هر چند دقیقه یک‌بار (حداقل ۵ دقیقه)
            </label>
            <input
              type="number"
              min={5}
              max={10080}
              value={form.intervalMinutes}
              onChange={(e) => {
                patchForm({ intervalMinutes: e.target.value });
                setPreview(null);
              }}
              className="input-field w-40"
              dir="ltr"
            />
            <p className="text-xs text-gray-500 mt-2">
              شمارش از لحظهٔ ذخیره و از هر اجرای بعدی شروع می‌شود.
            </p>
          </div>
        )}

        {form.kind === 'once' && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              تاریخ و ساعت ارسال (به وقت تهران)
            </label>
            <input
              type="datetime-local"
              value={form.onceAt}
              onChange={(e) => {
                patchForm({ onceAt: e.target.value });
                setPreview(null);
              }}
              className="input-field w-64"
              dir="ltr"
            />
            <p className="text-xs text-gray-500 mt-2">بعد از ارسال، خودِ زمان‌بندی خاموش می‌شود.</p>
          </div>
        )}

        {/* گروه‌های این ربات */}
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <label className="block text-sm font-medium text-gray-700">
              گروه‌هایی که آهنگ را می‌گیرند ({form.chatIds.length} از {formGroups.length})
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => patchForm({ chatIds: formGroups.map((group) => String(group.chatId)) })}
                className="btn-secondary text-xs py-1"
                disabled={formGroups.length === 0}
              >
                انتخاب همه
              </button>
              <button
                onClick={() => patchForm({ chatIds: [] })}
                className="btn-secondary text-xs py-1"
                disabled={form.chatIds.length === 0}
              >
                برداشتن انتخاب‌ها
              </button>
            </div>
          </div>
          {formGroups.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              {form.botId
                ? 'این ربات هنوز گروهی در فهرست ندارد. ربات را به گروه اضافه کنید و در گروه پیامی بفرستید تا آن گروه اینجا بیاید.'
                : 'اول ربات را انتخاب کنید.'}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {formGroups.map((group) => {
                const chatId = String(group.chatId);
                const checked = form.chatIds.includes(chatId);
                return (
                  <label
                    key={chatId}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition ${
                      checked ? 'bg-fuchsia-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGroup(chatId)}
                      className="w-4 h-4 text-fuchsia-600 rounded border-gray-300 focus:ring-fuchsia-500 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-gray-900 truncate">{group.title || 'گروه بدون نام'}</p>
                      <p className="text-xs text-gray-500 truncate" dir="ltr">
                        {group.username ? `@${group.username} · ` : ''}
                        {group.memberCount ? `${group.memberCount} عضو · ` : ''}
                        {chatId}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={saveSchedule}
            disabled={savingSchedule}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {savingSchedule ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                در حال ذخیره...
              </>
            ) : (
              <>
                <AlarmClock size={18} />
                {form.id ? 'به‌روزرسانی زمان‌بندی' : 'ساخت زمان‌بندی'}
              </>
            )}
          </button>
          <button onClick={previewSchedule} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={16} />
            پیش‌نمایش سه اجرای بعدی
          </button>
          {preview && (
            <div className="text-sm text-gray-700">
              {preview.ok ? (
                <span>
                  <b>{preview.label}</b> — {preview.upcoming.map((item: any) => item.label).join(' · ')}
                </span>
              ) : (
                <span className="text-red-600">{preview.error}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* زمان‌بندی‌های ثبت‌شده */}
      <div className="card">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
          <AlarmClock size={20} className="text-fuchsia-500" />
          زمان‌بندی‌های پخش خودکار
          <span className="text-sm font-normal text-gray-500">({schedules.length} زمان‌بندی)</span>
        </h2>
        {schedules.length === 0 ? (
          <p className="text-sm text-gray-500">
            هنوز زمان‌بندی‌ای نساخته‌اید. از فرم بالا ربات، ساعت و گروه‌ها را انتخاب کنید.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="text-right font-medium py-2">زمان‌بندی</th>
                  <th className="text-right font-medium py-2">ربات</th>
                  <th className="text-right font-medium py-2">گروه‌ها</th>
                  <th className="text-right font-medium py-2">اجرای بعدی</th>
                  <th className="text-right font-medium py-2">آخرین اجرا</th>
                  <th className="text-right font-medium py-2">وضعیت</th>
                  <th className="text-right font-medium py-2">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {schedules.map((row) => (
                  <tr key={row.id} className={row.isActive ? '' : 'opacity-60'}>
                    <td className="py-2.5">
                      <p className="font-bold text-gray-900">{row.name || 'بدون نام'}</p>
                      <p className="text-xs text-gray-500">{row.label}</p>
                      <p className="text-[11px] text-gray-400" dir="ltr">
                        #{row.id} · {row.runCount} اجرا
                      </p>
                    </td>
                    <td className="py-2.5 text-gray-700">{row.botName || `#${row.botId}`}</td>
                    <td className="py-2.5 text-gray-700">
                      <p>{row.groups.length} گروه</p>
                      <p className="text-xs text-gray-500 truncate max-w-[220px]">
                        {row.groups.map((group: any) => group.title).join('، ')}
                      </p>
                    </td>
                    <td className="py-2.5 text-gray-700">
                      {row.isActive ? row.nextRunLabel || '—' : 'خاموش'}
                    </td>
                    <td className="py-2.5">
                      <p className="text-gray-700">{row.lastRunLabel || '—'}</p>
                      {row.lastResult && (
                        <p className="text-[11px] text-gray-500 max-w-[260px] leading-5">{row.lastResult}</p>
                      )}
                    </td>
                    <td className="py-2.5">
                      {row.isActive ? (
                        <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5">
                          فعال
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5">
                          غیرفعال
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => runSchedule(row)}
                          disabled={runningId === row.id}
                          className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 disabled:opacity-50"
                          title="همین حالا یک آهنگ تصادفی در این گروه‌ها بفرست (ساعت بعدی عوض نمی‌شود)"
                        >
                          {runningId === row.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <PlayCircle size={14} />
                          )}
                          امتحان
                        </button>
                        <button
                          onClick={() => editSchedule(row)}
                          className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                          title="ویرایش"
                        >
                          <Pencil size={14} />
                          ویرایش
                        </button>
                        <button
                          onClick={() => toggleScheduleActive(row)}
                          className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                          title={row.isActive ? 'خاموش کردن موقت' : 'روشن کردن'}
                        >
                          {row.isActive ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                          {row.isActive ? 'خاموش' : 'روشن'}
                        </button>
                        <button
                          onClick={() => removeSchedule(row)}
                          className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
                          title="حذف زمان‌بندی"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* فهرست آهنگ‌ها */}
      <div className="card">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
          <Music2 size={20} className="text-fuchsia-500" />
          کتابخانه
          <span className="text-sm font-normal text-gray-500">({tracks.length} آهنگ)</span>
        </h2>

        {loading && tracks.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">در حال دریافت...</p>
        ) : tracks.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            کتابخانه خالی است. از بخش بالا آهنگ آپلود کنید؛ یا در گروه، فایل آهنگ را بفرستید و
            در کپشن بنویسید «پخش» تا ربات آن را در همین کتابخانهٔ مشترک حفظ کند.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="text-right font-medium py-2">آهنگ</th>
                  <th className="text-right font-medium py-2">منبع</th>
                  <th className="text-right font-medium py-2">مدت</th>
                  <th className="text-right font-medium py-2">حجم</th>
                  <th className="text-right font-medium py-2">پخش‌ها</th>
                  <th className="text-right font-medium py-2">وضعیت</th>
                  <th className="text-right font-medium py-2">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tracks.map((track) => (
                  <tr key={track.id} className={track.isActive ? '' : 'opacity-60'}>
                    <td className="py-2.5">
                      <p className="font-bold text-gray-900">{track.title}</p>
                      {track.artist && <p className="text-xs text-gray-500">{track.artist}</p>}
                      {!track.hasLocalFile && (
                        <p className="text-[11px] text-red-600">فایل روی سرور نیست</p>
                      )}
                    </td>
                    <td className="py-2.5 text-gray-700">
                      {SOURCE_LABEL[track.source] ?? track.source}
                    </td>
                    <td className="py-2.5 text-gray-700">{formatDuration(track.duration)}</td>
                    <td className="py-2.5 text-gray-700">{formatSize(track.fileSize)}</td>
                    <td className="py-2.5 font-bold text-gray-900">{track.playCount}</td>
                    <td className="py-2.5">
                      {track.isActive ? (
                        <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5">
                          فعال
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5">
                          غیرفعال
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setPlayTrackId(String(track.id));
                            document
                              .getElementById('music-play-card')
                              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }}
                          className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                          title="انتخاب برای پخش در گروه"
                        >
                          <PlayCircle size={14} />
                          پخش
                        </button>
                        <button
                          onClick={() => toggleActive(track)}
                          className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                          title={track.isActive ? 'موقت غیرفعال' : 'فعال کردن'}
                        >
                          {track.isActive ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                          {track.isActive ? 'خاموش' : 'روشن'}
                        </button>
                        <button
                          onClick={() => removeTrack(track)}
                          className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
                          title="حذف آهنگ"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card bg-blue-50 border-blue-200">
        <h3 className="font-bold text-blue-800 mb-2 flex items-center gap-2">
          <AlertCircle size={18} />
          راهنما
        </h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li>در گروه دستور <b dir="ltr">/play</b> یا <b dir="ltr">/music</b> را بفرستید؛ ربات یک آهنگ <b>تصادفی</b> از همین کتابخانه به‌شکل <b>ویس</b> می‌فرستد.</li>
          <li>روی همان ویس دو خط نوشته می‌شود: نام آهنگ و آیدی خودِ ربات. پیام متنی، دکمهٔ «آهنگ بعدی» یا «توقف» ارسال نمی‌شود.</li>
          <li>هر کاربری می‌تواند آهنگی را در گروه بفرستد و در کپشن بنویسد «پخش»؛ ربات آن را در کتابخانهٔ مشترک حفظ و همان لحظه پخش می‌کند.</li>
          <li>کتابخانه بین همهٔ ربات‌ها مشترک است؛ هر آهنگی که یک ربات بگیرد، بقیهٔ ربات‌ها هم می‌توانند پخشش کنند.</li>
          <li>آهنگ‌های غیرفعال در انتخاب تصادفی نمی‌آیند.</li>
          <li>در «پخش خودکار در ساعت تعیین‌شده» می‌توانید بگذارید ربات هر روز (یا هر چند دقیقه، یا یک بار) در ساعت مقرر، یک آهنگ تصادفی را در گروه‌های انتخابی به‌شکل ویس بفرستد.</li>
          <li>اگر ربات در ساعت مقرر فعال نباشد یا دسترسی موزیکش بسته شده باشد، در همان زمان چیزی ارسال نمی‌شود و دلیلش در ستون «آخرین اجرا» همان زمان‌بندی نوشته می‌شود.</li>
          <li>حداکثر حجم {MAX_UPLOAD_MB} مگابایت است (تنظیم <b dir="ltr">music_max_mb</b> در بخش تنظیمات).</li>
          <li>پخش برای ربات‌هایی که در بخش «ربات‌ها» تیک موزیک ندارند، خاموش است.</li>
        </ul>
      </div>
    </div>
  );
}
