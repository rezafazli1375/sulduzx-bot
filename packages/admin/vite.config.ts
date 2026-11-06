import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// نسخه و سازندهٔ پنل از package.json همین بسته خوانده می‌شود و داخل باندل
// می‌نشیند (define). پس عددی که در پنل دیده می‌شود همان نسخهٔ نصب‌شده است و
// لازم نیست هیچ‌جا دستی به‌روز شود. fallback برای حالتی است که فایل پیدا نشود.
function ownPackage(): { version: string; author: string } {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    const author =
      typeof pkg.author === 'string'
        ? pkg.author
        : pkg?.author?.name || 'تیم سولدوز سرور';
    return { version: pkg.version || 'نامشخص', author: author || 'تیم سولدوز سرور' };
  } catch {
    return { version: 'نامشخص', author: 'تیم سولدوز سرور' };
  }
}

const pkg = ownPackage();

export default defineConfig({
  plugins: [react()],
  define: {
    __PANEL_VERSION__: JSON.stringify(pkg.version),
    __PANEL_AUTHOR__: JSON.stringify(pkg.author),
    __PANEL_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
