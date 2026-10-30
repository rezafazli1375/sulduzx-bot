# راهنمای دیپلوی

این راهنما برای نصب روی یک سرور لینوکسی (Ubuntu/Debian یا هر توزیع با apt/dnf/yum) با Docker نوشته شده است.

## ۱) نصب خودکار (پیشنهادی)

```bash
curl -fsSL https://raw.githubusercontent.com/rezafazli1375/sulduzx-bot/main/install.sh | sudo bash
```

با دامنه و گواهی SSL خودکار:

```bash
curl -fsSL https://raw.githubusercontent.com/rezafazli1375/sulduzx-bot/main/install.sh | sudo bash -s -- \
  --domain panel.example.com --email you@example.com
```

بدون پرسش (مناسب اسکریپت/CI):

```bash
sudo BOT_TOKEN=... ADMIN_IDS=123456 ADMIN_USERNAME=admin ADMIN_PASSWORD='رمز-قوی' \
  bash install.sh --yes --domain panel.example.com --email you@example.com
```

> اگر متغیرها را با `export` تنظیم کرده‌اید، `sudo -E` بزنید؛ `sudo` به‌طور پیش‌فرض محیط را پاک می‌کند. بدون ترمینال تعاملی، نصب‌کننده با پیام واضح متوقف می‌شود و BOT_TOKEN/ADMIN_IDS را از متغیر محیطی می‌خواند.

نصب‌کننده چه می‌کند:

| مرحله | کار |
| --- | --- |
| پیش‌نیازها | `curl`, `tar`, `openssl`, `git`, Docker + Compose (در صورت نبود) |
| فایل‌ها | کپی پروژه به `/opt/sulduz-bot` (یا `--dir`) |
| `.env` | پرسش توکن/ادمین/پنل و ساخت `JWT_SECRET` و رمز دیتابیس تصادفی، `chmod 600` |
| ایمیج | `docker compose build` |
| دیتابیس | `up -d postgres` + انتظار `pg_isready` + `prisma db push` + `db:seed` |
| سرویس | `docker compose up -d` و بررسی پاسخ پنل روی `127.0.0.1:9090` |
| ابزار | نصب `sulduzx` در `/usr/local/bin` و نوشتن `/etc/sulduzx.conf` |
| دامنه | در صورت `--domain`: Nginx + certbot + به‌روزرسانی `ADMIN_PANEL_URL` |

گزینه‌های دیگر: `--no-ssl`, `--force-env`, `--dry-run`, `--repo`, `--branch`.

پورت‌ها: پنل روی `9090` (عمومی)، API روی `127.0.0.1:3000` و دیتابیس روی `127.0.0.1:5432` (فقط محلی).

## ۲) منوی مدیریت: `sulduzx`

بعد از نصب، در SSH بنویسید `sulduzx`:

```bash
sulduzx            # منوی تعاملی
sulduzx status     # وضعیت کانتینرها + سلامت API (/api/health)
sulduzx logs       # لاگ زنده ربات
sulduzx username newadmin
sulduzx password   # رمز از stdin خوانده می‌شود
sulduzx domain --domain panel.example.com --email you@example.com
sulduzx backup     # بکاپ gzip در data/backups
sulduzx update     # git pull + build + up -d + db push
```

اگر چند حساب مدیر دارید، با `--user <نام-فعلی>` حساب مشخص را هدف بگیرید:

```bash
sulduzx password --user oldadmin
```

## ۳) نصب دستی

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
docker compose version

# پروژه
sudo mkdir -p /opt/sulduz-bot && cd /opt/sulduz-bot
sudo git clone https://github.com/rezafazli1375/sulduzx-bot.git .
sudo cp .env.example .env
sudo nano .env          # توکن ربات، آیدی ادمین، اطلاعات پنل x-ui، JWT_SECRET، ADMIN_USERNAME/PASSWORD

sudo docker compose up -d --build
sudo docker compose run --rm --no-deps bot npx prisma db push --skip-generate
sudo docker compose run --rm --no-deps bot npm run db:seed
docker compose ps
docker compose logs -f bot

# ابزار مدیریت
sudo install -m 0755 scripts/sulduzx.sh /usr/local/bin/sulduzx
echo 'SULDUZX_DIR="/opt/sulduz-bot"' | sudo tee /etc/sulduzx.conf
```

## ۴) دامنه و HTTPS

ساده‌ترین راه، گزینه ۷ منوی `sulduzx` است. این گزینه:

1. Nginx را (در صورت نبود) نصب می‌کند
2. کانفیگ زیر را در `/etc/nginx/sites-available/sulduzx` (یا `/etc/nginx/conf.d/sulduzx.conf`) می‌نویسد و فعال می‌کند
3. با `nginx -t` اعتبارسنجی و `systemctl reload nginx` اعمال می‌کند
4. با `certbot --nginx --redirect` گواهی Let's Encrypt می‌گیرد و HTTPS را فعال می‌کند
5. `ADMIN_PANEL_URL` را در `.env` به‌روز کرده و کانتینر ربات را ری‌استارت می‌کند

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name panel.example.com;

    client_max_body_size 30m;   # برای آپلود فایل بکاپ در بازگردانی

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```

نکته: API لازم نیست جداگانه پروکسی شود؛ کانتینر پنل مسیر `/api` را به سرویس `bot` می‌فرستد.

پیش‌نیاز گواهی: رکورد A دامنه به IP سرور اشاره کند و پورت ۸۰ از بیرون باز باشد. برای تست می‌توانید `--staging` بزنید.

## ۵) پس از نصب

1. با `ADMIN_USERNAME` / `ADMIN_PASSWORD` وارد پنل شوید و رمز را از صفحه **حساب کاربری** یا `sulduzx password` عوض کنید.
2. در **تنظیمات** اطلاعات پنل 3x-ui (`PANEL_BASE_URL`, `PANEL_USERNAME`, `PANEL_PASSWORD`, `PANEL_INBOUND_ID`) را وارد کنید.
3. در **کانال‌ها** کانال‌های عضویت اجباری را ثبت کنید (ربات باید ادمین کانال باشد).
4. از **بکاپ و بازگردانی** یک نسخه اولیه بگیرید (یا `sulduzx backup`).

## به‌روزرسانی

```bash
sulduzx update          # یا:
cd /opt/sulduz-bot && git pull && docker compose build bot admin && docker compose up -d
```

دیتابیس و فایل‌های بکاپ در volume و پوشه `./data` باقی می‌مانند.

## عیب‌یابی

| مشکل | بررسی |
| --- | --- |
| ربات بالا نمی‌آید | `sulduzx logs`؛ توکن و دسترسی اینترنت سرور به `api.telegram.org` |
| پنل باز نمی‌شود | `sulduzx status` و باز بودن پورت 9090 |
| `sulduzx` پیدا نمی‌شود | `install -m 0755 /opt/sulduz-bot/scripts/sulduzx.sh /usr/local/bin/sulduzx` |
| گواهی SSL گرفته نشد | DNS دامنه، باز بودن پورت ۸۰، و لاگ `certbot`؛ برای تست `--staging` |
| خطای اتصال به پنل x-ui | `PANEL_BASE_URL` و دسترسی شبکه کانتینر به پنل |
| خطای دانلودر یوتیوب | احتمالاً IP سرور محدود شده؛ از پروکسی `YTDLP_PROXY` یا تنظیم پروکسی در پنل استفاده کنید |
| تست پروکسی V2Ray خطا می‌دهد | در تنظیمات → پروکسی دانلودر، لینک/کانفیگ را بررسی و «تست اتصال» را بزنید؛ پیام خطا معمولاً علت (DNS، پورت، TLS یا invalid uuid) را نشان می‌دهد |
| `xray: not found` در لاگ ربات | ایمیج قدیمی است؛ `docker compose build bot` را دوباره اجرا کنید (xray-core داخل ایمیج نصب می‌شود) |
| تبدیل Word به PDF خطا می‌دهد | حجم ایمیج بالاست و LibreOffice داخل آن است؛ `docker compose build bot` را کامل اجرا کنید |
