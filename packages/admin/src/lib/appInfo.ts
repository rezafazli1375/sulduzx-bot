// ─── appInfo.ts — نسخهٔ ربات، نسخهٔ پنل و سازنده، در یک جا ───
//
// چرا: مالک خواسته نسخهٔ برنامه و نام سازنده در پنل نوشته شود. دو عدد با هم
// فرق دارند و باید جدا نشان داده شوند:
//   • نسخهٔ ربات از /api/health خوانده می‌شود = همان package.jsonِ رباتِ در حال
//     اجرا روی سرور (بنابراین بعد از هر استقرار خودکار درست می‌شود).
//   • نسخهٔ پنل هنگام build داخل باندل می‌نشیند (__PANEL_VERSION__ در vite.config)
//     و با تغییر کد ربات عوض نمی‌شود.
// اگر ربات در دسترس نباشد، جای آن «—» می‌نشیند و پنل باز می‌ماند.

import { useEffect, useState } from 'react';
import axios from 'axios';

declare const __PANEL_VERSION__: string | undefined;
declare const __PANEL_AUTHOR__: string | undefined;
declare const __PANEL_BUILD_TIME__: string | undefined;

export const DEFAULT_AUTHOR = 'تیم سولدوز سرور';

/** نسخهٔ همین بیلدِ پنل (از package.json/packages/admin هنگام build) */
export const PANEL_VERSION: string =
  typeof __PANEL_VERSION__ === 'string' && __PANEL_VERSION__ ? __PANEL_VERSION__ : 'نامشخص';

export const PANEL_AUTHOR: string =
  typeof __PANEL_AUTHOR__ === 'string' && __PANEL_AUTHOR__ ? __PANEL_AUTHOR__ : DEFAULT_AUTHOR;

/** زمان build پنل — برای این که معلوم شود کدام بیلد از پنل سرو می‌شود */
export const PANEL_BUILD_TIME: string =
  typeof __PANEL_BUILD_TIME__ === 'string' ? __PANEL_BUILD_TIME__ : '';

export interface BotAppInfo {
  version: string | null;
  author: string;
  buildTime: string | null;
  uptimeSec: number | null;
  node: string | null;
  /** false یعنی /api/health جواب نداد (ربات پایین است) */
  reachable: boolean;
}

const EMPTY: BotAppInfo = {
  version: null,
  author: PANEL_AUTHOR || DEFAULT_AUTHOR,
  buildTime: null,
  uptimeSec: null,
  node: null,
  reachable: false,
};

/** یک بار در هر بار باز شدن پنل خوانده می‌شود؛ خطا هیچ‌جا را نمی‌شکند */
export function useBotAppInfo(): BotAppInfo {
  const [info, setInfo] = useState<BotAppInfo>(EMPTY);

  useEffect(() => {
    let alive = true;
    axios
      .get('/api/health', { timeout: 8000 })
      .then((res) => {
        if (!alive) return;
        const d = res.data ?? {};
        setInfo({
          version: typeof d.version === 'string' && d.version ? d.version : null,
          author: typeof d.author === 'string' && d.author ? d.author : PANEL_AUTHOR || DEFAULT_AUTHOR,
          buildTime: typeof d.buildTime === 'string' && d.buildTime ? d.buildTime : null,
          uptimeSec: typeof d.uptime === 'number' ? d.uptime : null,
          node: typeof d.node === 'string' ? d.node : null,
          reachable: !!d.ok,
        });
      })
      .catch(() => {
        if (alive) setInfo({ ...EMPTY, author: PANEL_AUTHOR || DEFAULT_AUTHOR });
      });
    return () => {
      alive = false;
    };
  }, []);

  return info;
}

/** «۱۴۰۵/۰۸/۱۵ ۲۰:۳۱» — تا مالک بداند این بیلد کِی ساخته شده */
export function faDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      calendar: 'persian',
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}
