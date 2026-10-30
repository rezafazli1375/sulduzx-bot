# راهنمای دیپلوی

این راهنما برای نصب روی یک سرور لینوکسی (Ubuntu/Debian) با Docker نوشته شده است.

## ۱) آماده‌سازی سرور

```bash
# نصب Docker و Docker Compose
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
docker compose version
```

پورت‌های مورد نیاز: `9090` (پنل مدیریت)، `3000` (API). اگر پنل را عمومی می‌کنید، بهتر است پورت `3000` را به بیرون باز نکنید و فقط Nginx را رو به بیرون بگذارید.

## ۲) انتقال پروژه

```bash
mkdir -p /opt/telegram-bot && cd /opt/telegram-bot
git clone <repository-url> .
cp .env.example .env
nano .env
```

## ۳) اجرا

```bash
docker compose up -d --build
docker compose exec -T bot npx prisma db push
docker compose exec -T bot npm run db:seed
docker compose ps
docker compose logs -f bot
```

## ۴) دامنه و HTTPS (اختیاری اما توصیه‌شده)

نمونه Nginx برای پنل (پورت 9090) و API (پورت 3000):

```nginx
server {
    listen 80;
    server_name bot.example.com;

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    client_max_body_size 30m;   # برای آپلود فایل بکاپ در بازگردانی
}
```

سپس:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d bot.example.com
```

`ADMIN_PANEL_URL` را در `.env` روی همان دامنه تنظیم کنید.

## ۵) پس از نصب

1. با `ADMIN_USERNAME` / `ADMIN_PASSWORD` وارد پنل شوید و رمز را از صفحه **حساب کاربری** عوض کنید.
2. در **تنظیمات** اطلاعات پنل 3x-ui (`PANEL_BASE_URL`, `PANEL_USERNAME`, `PANEL_PASSWORD`, `PANEL_INBOUND_ID`) را وارد کنید.
3. در **کانال‌ها** کانال‌های عضویت اجباری را ثبت کنید (ربات باید ادمین کانال باشد).
4. از **بکاپ و بازگردانی** یک نسخه اولیه بگیرید.

## به‌روزرسانی

```bash
cd /opt/telegram-bot
git pull
docker compose build bot admin
docker compose up -d
```

دیتابیس و فایل‌های بکاپ در volume و پوشه `./data` باقی می‌مانند.

## عیب‌یابی

| مشکل | بررسی |
| --- | --- |
| ربات بالا نمی‌آید | `docker compose logs bot`؛ توکن و دسترسی اینترنت سرور به `api.telegram.org` |
| پنل باز نمی‌شود | `docker compose ps` و باز بودن پورت 9090 |
| خطای اتصال به پنل x-ui | `PANEL_BASE_URL` و دسترسی شبکه کانتینر به پنل |
| خطای دانلودر یوتیوب | احتمالاً IP سرور محدود شده؛ از پروکسی `YTDLP_PROXY` یا تنظیم پروکسی در پنل استفاده کنید |
| تبدیل Word به PDF خطا می‌دهد | حجم ایمیج بالاست و LibreOffice داخل آن است؛ `docker compose build bot` را کامل اجرا کنید |
