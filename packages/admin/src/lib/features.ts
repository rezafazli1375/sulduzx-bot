export const FEATURE_LABELS: { key: string; label: string }[] = [
  { key: 'free_config', label: 'دریافت کانفیگ رایگان' },
  { key: 'shop', label: 'فروشگاه' },
  { key: 'proxy', label: 'پروکسی تلگرام' },
  { key: 'referral', label: 'زیرمجموعه‌گیری' },
  { key: 'points', label: 'امتیازها' },
  { key: 'downloader', label: 'دانلودر' },
  { key: 'voice_convert', label: 'تبدیل ویس' },
  { key: 'word_to_pdf', label: 'Word به PDF' },
  { key: 'video_to_mp3', label: 'ویدیو به MP3' },
  { key: 'server_status', label: 'وضعیت سرور' },
  { key: 'support', label: 'پشتیبانی' },
];

export function featureLabel(key: string) {
  return FEATURE_LABELS.find((item) => item.key === key)?.label || key;
}

export function formatDateTime(value?: string | Date | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString('fa-IR')} - ${date.toLocaleTimeString('fa-IR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}
