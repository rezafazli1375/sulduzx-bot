// ─── app-info.ts — نسخهٔ واقعیِ همین بیلد (نام / نسخه / سازنده / زمان ساخت) ───
//
// چرا این فایل هست: تا امروز هیچ‌جا در پنل مدیریت نوشته نشده بود که این ربات
// و پنل روی چه نسخه‌ای اجرا می‌شوند، و برای پیگیری باگ‌ها («این اصلاح روی
// سرور من هست یا نه؟») هیچ منبع واحدی وجود نداشت.
//
// قاعده: تنها منبع حقیقت، package.jsonِ خودِ بسته است — همان فایلی که با
// آرشیو گیت‌هاب نصب می‌شود. پس عددی که در پنل دیده می‌شود دقیقاً عددِ همان
// باندلِ نصب‌شده است، نه چیزی که در سورسِ توسعه‌دهنده جا مانده باشد.
//
// importِ مستقیم JSON ممکن نیست: tsconfig ربات rootDir=./src دارد و خواندن
// فایل بیرون از src خطای «outside rootDir» می‌دهد؛ پس فایل با fs باز می‌شود
// و مسیرش از کنار همین ماژول (dist/lib → ../../package.json) پیدا می‌شود.

import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** سازندهٔ برنامه — اگر در package.json نباشد همین مقدار نشان داده می‌شود */
export const DEFAULT_AUTHOR = 'تیم سولدوز سرور';

export interface AppInfo {
  name: string;
  version: string;
  author: string;
  /** زمان ساخت باندل = mtime فایل ورودیِ کامپایل‌شده (dist/index.js) */
  buildTime: string | null;
  /** زمان بالا آمدن همین پروسه */
  startedAt: string;
  node: string;
}

function firstExistingJson(paths: string[]): Record<string, any> | null {
  for (const p of paths) {
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      // فایل نیست یا JSON خراب است → بعدی را امتحان کن
    }
  }
  return null;
}

/** package.json همین بسته (ربات) — از چند مسیرِ ممکن، اولین خواندنی */
function readOwnPackageJson(): Record<string, any> | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dist/lib/app-info.js → /app/package.json
    join(here, '..', '..', 'package.json'),
    // src/lib/app-info.ts (tsx dev) → /app/package.json
    join(here, '..', 'package.json'),
    // اگر cwd بسته عوض شده باشد
    join(process.cwd(), 'package.json'),
  ];
  return firstExistingJson(candidates);
}

/** زمان ساخت: mtimeِ dist/index.js؛ در حالت توسعه (tsx) null */
function readBuildTime(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'index.js'), // dist/lib → dist/index.js
    join(process.cwd(), 'dist', 'index.js'),
  ];
  for (const p of candidates) {
    try {
      return new Date(statSync(p).mtime).toISOString();
    } catch {
      // بعدی را امتحان کن
    }
  }
  return null;
}

function authorFrom(pkg: Record<string, any> | null): string {
  const a = pkg?.author;
  if (typeof a === 'string' && a.trim()) return a.trim();
  // npm اجازه می‌دهد author شیء باشد: { name, email, url }
  if (a && typeof a === 'object' && typeof a.name === 'string' && a.name.trim()) return a.name.trim();
  return DEFAULT_AUTHOR;
}

/** اطلاعات نسخه، یک‌بار هنگام بالا آمدن پروسه خوانده می‌شود */
export function getAppInfo(): AppInfo {
  const pkg = readOwnPackageJson();
  return {
    name: typeof pkg?.name === 'string' && pkg.name ? pkg.name : 'sulduz-bot',
    version: typeof pkg?.version === 'string' && pkg.version ? pkg.version : 'نامشخص',
    author: authorFrom(pkg),
    buildTime: readBuildTime(),
    startedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
    node: process.version,
  };
}

export const APP_INFO: AppInfo = getAppInfo();
