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
} from 'lucide-react';
import { formatDateTime } from '../lib/features';
import VoiceCallPanel from '../components/VoiceCallPanel';

const MAX_UPLOAD_MB = 20;

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

const KIND_LABEL: Record<string, string> = {
  audio: '🎵 آهنگ',
  document: '📄 فایل MP3',
  voice: '🎙 ویس',
};

const SOURCE_LABEL: Record<string, string> = {
  panel: 'آپلود پنل',
  group: 'ارسالی کاربر',
};

export default function Music() {
  const [tracks, setTracks] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [bots, setBots] = useState<any[]>([]);
  const [botId, setBotId] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    axios
      .get('/api/bots')
      .then((res) => setBots(res.data ?? []))
      .catch((err) => console.error('Load bots error:', err));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (botId) params.botId = botId;
      const [listRes, statsRes] = await Promise.all([
        axios.get('/api/music', { params }),
        axios.get('/api/music/stats'),
      ]);
      setTracks(listRes.data.tracks ?? []);
      setStats(statsRes.data);
      setError('');
    } catch (err: any) {
      console.error('Load music error:', err);
      setError(err.response?.data?.error || 'خطا در دریافت اطلاعات موزیک');
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 4000);
  };

  const handleUpload = async () => {
    setError('');
    if (!botId) {
      setError('ابتدا ربات را انتخاب کنید');
      return;
    }
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
        botId: parseInt(botId, 10),
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
      flash('✅ آهنگ به کتابخانه اضافه شد');
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

  const statCards = [
    { label: 'کل آهنگ‌ها', value: stats?.totalTracks ?? 0, icon: Music2 },
    { label: 'آهنگ‌های فعال', value: stats?.activeTracks ?? 0, icon: Headphones },
    { label: 'کل پخش‌ها', value: stats?.totalPlays ?? 0, icon: PlayCircle },
    { label: 'پخش امروز', value: stats?.playsToday ?? 0, icon: MusicIcon },
  ];

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
            کتابخانهٔ آهنگ‌هایی که ربات در گروه‌ها پخش می‌کند
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={botId}
            onChange={(e) => setBotId(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-fuchsia-500 outline-none"
          >
            <option value="">همهٔ ربات‌ها</option>
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
          <button
            onClick={load}
            className="btn-secondary flex items-center gap-2"
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            بروزرسانی
          </button>
        </div>
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
                    <td className="py-2.5 text-gray-700">{play.requestName || '—'}</td>
                    <td className="py-2.5 text-gray-500">{formatDateTime(play.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* حساب ویس‌کال و حالت پخش گروه‌ها */}
      <VoiceCallPanel tracks={tracks} onNotice={flash} />

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
          افزودن آهنگ
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">ربات</label>
            <select
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              className="input-field"
            >
              <option value="">انتخاب کنید…</option>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                </option>
              ))}
            </select>
          </div>
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
          <div className="md:col-span-2">
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
          <div className="flex items-end">
            <button
              onClick={handleUpload}
              disabled={uploading || !file || !botId}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
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
            در کپشن بنویسید «پخش» تا ربات آن را حفظ کند.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="text-right font-medium py-2">آهنگ</th>
                  <th className="text-right font-medium py-2">ربات</th>
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
                      <p className="text-[11px] text-gray-400">
                        {KIND_LABEL[track.kind] ?? track.kind}
                        {!track.hasFileId && !track.hasLocalFile && ' · فایل در دسترس نیست'}
                      </p>
                    </td>
                    <td className="py-2.5 text-gray-700">{track.botName ?? `#${track.botId}`}</td>
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
          <li>در گروه دستور <b dir="ltr">/music</b> را بفرستید تا کارت پخش با دکمه‌های «🔀 آهنگ بعدی» و «⏹ توقف» ساخته شود.</li>
          <li><b dir="ltr">/play</b> یک آهنگ را به‌صورت تصادفی از همین کتابخانه پخش می‌کند.</li>
          <li>هر کاربری می‌تواند آهنگی را در گروه بفرستد و در کپشن بنویسد «پخش»؛ ربات آن را در کتابخانه حفظ می‌کند.</li>
          <li>وقتی آهنگ قطع شود، پیام‌های ربات ۱۰ ثانیه بعد از گروه پاک می‌شوند.</li>
          <li>آهنگ‌های غیرفعال در انتخاب تصادفی نمی‌آیند و در گروه قابل پخش نیستند.</li>
          <li>حداکثر حجم آپلود {MAX_UPLOAD_MB} مگابایت است (تنظیم <b dir="ltr">music_max_mb</b> در بخش تنظیمات).</li>
        </ul>
      </div>
    </div>
  );
}
