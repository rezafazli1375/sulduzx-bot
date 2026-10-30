#!/bin/bash
# نصب سریع روی سرور لینوکسی (Ubuntu/Debian)
# استفاده: sudo DOMAIN=bot.example.com ./deploy.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}لطفاً با root اجرا کنید${NC}"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo -e "${YELLOW}نصب Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

if [ ! -f .env ]; then
  echo -e "${YELLOW}ساخت .env از نمونه...${NC}"
  cp .env.example .env
  echo -e "${RED}⚠️  فایل .env را با اطلاعات خودتان پر کنید: nano .env${NC}"
  read -r -p "بعد از ویرایش Enter بزنید..."
fi

echo -e "${YELLOW}ساخت و اجرای کانتینرها...${NC}"
docker compose up -d --build

echo -e "${YELLOW}آماده‌سازی دیتابیس...${NC}"
sleep 8
docker compose exec -T bot npx prisma db push
docker compose exec -T bot npm run db:seed

if [ -n "$DOMAIN" ]; then
  echo -e "${YELLOW}پیکربندی Nginx برای ${DOMAIN}...${NC}"
  cat > /etc/nginx/sites-available/telegram-bot <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/telegram-bot /etc/nginx/sites-enabled/telegram-bot
  nginx -t && systemctl reload nginx
  echo -e "${GREEN}برای HTTPS: certbot --nginx -d ${DOMAIN}${NC}"
fi

echo -e "${GREEN}✅ نصب کامل شد${NC}"
echo -e "${GREEN}پنل: http://SERVER_IP:9090${NC}"
echo -e "${YELLOW}نام کاربری/رمز اولیه در .env تنظیم می‌شود (ADMIN_USERNAME/ADMIN_PASSWORD).${NC}"
echo -e "${RED}بعد از اولین ورود رمز را از صفحه «حساب کاربری» عوض کنید.${NC}"
