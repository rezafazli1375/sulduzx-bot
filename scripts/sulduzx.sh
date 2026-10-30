#!/usr/bin/env bash
# Sulduz Cloud — منوی مدیریت روی SSH
# نصب: install.sh این فایل را در /usr/local/bin/sulduzx قرار می‌دهد.
set -uo pipefail

SULDUZX_VERSION="1.0.0"
CONFIG_FILE="/etc/sulduzx.conf"

if [ -z "${SULDUZX_DIR:-}" ] && [ -r "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
fi
SULDUZX_DIR="${SULDUZX_DIR:-/opt/sulduz-bot}"

if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_CYAN=$'\033[36m'
else
  C_RESET=""
  C_BOLD=""
  C_DIM=""
  C_RED=""
  C_GREEN=""
  C_YELLOW=""
  C_CYAN=""
fi

info() { printf '%s%s%s\n' "$C_CYAN" "$*" "$C_RESET"; }
ok() { printf '%s%s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
warn() { printf '%s%s%s\n' "$C_YELLOW" "$*" "$C_RESET"; }
err() { printf '%s%s%s\n' "$C_RED" "$*" "$C_RESET" >&2; }
die() {
  err "$*"
  exit 1
}

usage() {
  cat <<EOF
${C_BOLD}Sulduz Cloud${C_RESET} ${C_DIM}v${SULDUZX_VERSION}${C_RESET}

استفاده: sulduzx [دستور]

دستورها:
  sulduzx                     منوی تعاملی
  sulduzx status              وضعیت کانتینرها و سلامت API
  sulduzx start | restart     روشن کردن / ری‌استارت سرویس‌ها
  sulduzx stop                توقف سرویس‌ها
  sulduzx logs                مشاهده زنده لاگ ربات
  sulduzx username <نام>      تغییر نام کاربری مدیر پنل
  sulduzx password            تغییر رمز عبور مدیر پنل (تعاملی یا از stdin)
                             با گزینه --user <نام-فعلی> یک مدیر مشخص را هدف بگیرید
  sulduzx domain              تنظیم دامنه و دریافت گواهی SSL خودکار
  sulduzx env                 ویرایش فایل .env
  sulduzx backup              بکاپ دستی دیتابیس
  sulduzx update              دریافت نسخه جدید و بیلد مجدد
  sulduzx help                همین راهنما

گزینه‌های دستور domain:
  --domain example.com --email you@example.com   بدون پرسش اجرا می‌شود
  --staging        استفاده از سرور آزمایشی Let's Encrypt
  --print-config   فقط کانفیگ Nginx را چاپ کن (بدون تغییر)
  --dry-run        نمایش کارها بدون اعمال تغییر
  --yes            تأیید خودکار نصب پیش‌نیازها

مسیر نصب: ${SULDUZX_DIR}
EOF
}

have() { command -v "$1" >/dev/null 2>&1; }

require_install() {
  have docker || die "Docker نصب نیست. ابتدا install.sh را اجرا کنید."
  [ -d "$SULDUZX_DIR" ] || die "مسیر نصب پیدا نشد: $SULDUZX_DIR"
  [ -f "$SULDUZX_DIR/docker-compose.yml" ] || die "docker-compose.yml در $SULDUZX_DIR پیدا نشد"
  [ -f "$SULDUZX_DIR/.env" ] || die "فایل .env در $SULDUZX_DIR پیدا نشد"
}

dc() {
  docker compose --project-directory "$SULDUZX_DIR" --env-file "$SULDUZX_DIR/.env" "$@"
}

get_env() {
  local key="$1" value=""
  [ -f "$SULDUZX_DIR/.env" ] || return 0
  value="$(grep -E "^${key}=" "$SULDUZX_DIR/.env" | tail -n1 | cut -d= -f2-)"
  case "$value" in
  \"*\")
    value="${value#\"}"
    value="${value%\"}"
    value="${value//\\\"/\"}"
    value="${value//\\\\/\\}"
    ;;
  esac
  printf '%s' "$value"
}

set_env() {
  local key="$1" value="$2" file="$SULDUZX_DIR/.env" tmp
  [ -f "$file" ] || die "فایل .env پیدا نشد: $file"
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    index($0, k "=") == 1 { print k "=" v; found = 1; next }
    { print }
    END { if (!found) print k "=" v }
  ' "$file" >"$tmp" && mv "$tmp" "$file"
  chmod 600 "$file"
}

read_tty() {
  local prompt="$1" var="$2"
  if [ -r /dev/tty ]; then
    read -r -p "$prompt" "$var" </dev/tty
  else
    read -r -p "$prompt" "$var"
  fi
}

read_secret() {
  local prompt="$1" var="$2"
  if [ -r /dev/tty ]; then
    read -r -s -p "$prompt" "$var" </dev/tty
  else
    read -r -s -p "$prompt" "$var"
  fi
  printf '\n'
}

confirm() {
  local prompt="$1" answer=""
  read_tty "$prompt [y/N] " answer || true
  case "$answer" in
  y | Y | yes | YES | بله) return 0 ;;
  *) return 1 ;;
  esac
}

bot_running() {
  [ -n "$(dc ps --status running -q bot 2>/dev/null)" ]
}

# اجرای admin-cli داخل کانتینر؛ اگر ایمیج قدیمی باشد اسکریپت تزریق می‌شود.
admin_cli() {
  local script="$SULDUZX_DIR/packages/bot/scripts/admin-cli.mjs"
  [ -f "$script" ] || die "فایل $script پیدا نشد"
  bot_running || die "کانتینر ربات در حال اجرا نیست. ابتدا: sulduzx start"

  if dc exec -T bot test -f /app/scripts/admin-cli.mjs </dev/null >/dev/null 2>&1; then
    dc exec -T -w /app bot node /app/scripts/admin-cli.mjs "$@"
    return $?
  fi

  dc exec -T bot sh -c 'cat > /app/.admin-cli.mjs' <"$script" || return 1
  dc exec -T -w /app bot node /app/.admin-cli.mjs "$@"
}

show_status() {
  require_install
  info "📁 مسیر نصب: $SULDUZX_DIR"
  echo
  dc ps || true
  echo

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/api/health 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    ok "🟢 API ربات: سالم (HTTP 200)"
  else
    err "🔴 API ربات: پاسخ نامعتبر (${code:-بدون پاسخ})"
  fi

  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:9090/ 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    ok "🟢 پنل مدیریت محلی: سالم (HTTP 200)"
  else
    err "🔴 پنل مدیریت محلی: پاسخ نامعتبر (${code:-بدون پاسخ})"
  fi

  local panel_url
  panel_url="$(get_env ADMIN_PANEL_URL)"
  [ -n "$panel_url" ] && info "🌐 آدرس عمومی پنل: $panel_url"
  return 0
}

cmd_start() {
  require_install
  dc up -d
  ok "✅ سرویس‌ها روشن شدند."
  show_status
}

cmd_restart() {
  require_install
  dc up -d
  dc restart bot admin
  ok "✅ سرویس‌ها ری‌استارت شدند."
  show_status
}

cmd_stop() {
  require_install
  if [ "${1:-}" != "--yes" ] && ! confirm "سرویس‌ها متوقف شوند؟"; then
    warn "لغو شد."
    return 0
  fi
  dc stop
  ok "⏹ سرویس‌ها متوقف شدند. داده‌ها دست‌نخورده باقی می‌مانند."
}

cmd_logs() {
  require_install
  dc logs -f --tail=120 bot
}

cmd_username() {
  require_install
  local next="" current="" script_args=()

  while [ $# -gt 0 ]; do
    case "$1" in
    --user)
      current="${2:-}"
      shift 2 || die "مقدار --user داده نشده"
      ;;
    -*) die "گزینه ناشناخته: $1" ;;
    *)
      if [ -z "$next" ]; then
        next="$1"
        shift
      else
        die "گزینه اضافی: $1"
      fi
      ;;
    esac
  done

  if [ -z "$next" ]; then
    read_tty "نام کاربری جدید (۳ تا ۳۲ نویسه، حروف انگلیسی/عدد/. _ -): " next || return 1
  fi
  next="$(printf '%s' "$next" | tr -d '[:space:]')"
  [[ "$next" =~ ^[A-Za-z0-9._-]{3,32}$ ]] || die "نام کاربری نامعتبر است."
  [ -n "$current" ] && script_args+=(--user "$current")

  if admin_cli username "$next" "${script_args[@]}"; then
    set_env ADMIN_USERNAME "$next"
    ok "✅ نام کاربری در .env هم به‌روزرسانی شد."
  else
    err "❌ تغییر نام کاربری انجام نشد."
    return 1
  fi
}

cmd_password() {
  require_install
  local pass="" current="" script_args=()

  while [ $# -gt 0 ]; do
    case "$1" in
    --user)
      current="${2:-}"
      shift 2 || die "مقدار --user داده نشده"
      ;;
    -*) die "گزینه ناشناخته: $1" ;;
    *)
      if [ -z "$pass" ]; then
        pass="$1"
        shift
      else
        die "گزینه اضافی: $1"
      fi
      ;;
    esac
  done
  [ -n "$current" ] && script_args+=(--user "$current")

  if [ -z "$pass" ]; then
    if [ -t 0 ]; then
      local pass2=""
      while true; do
        read_secret "رمز عبور جدید (حداقل ۸ نویسه): " pass
        [ ${#pass} -ge 8 ] || {
          warn "رمز کوتاه است."
          continue
        }
        read_secret "تکرار رمز جدید: " pass2
        [ "$pass" = "$pass2" ] || {
          warn "رمزها یکسان نیستند."
          continue
        }
        break
      done
    else
      IFS= read -r pass || true
    fi
  fi

  [ ${#pass} -ge 8 ] || die "رمز عبور باید حداقل ۸ نویسه باشد."

  if printf '%s' "$pass" | admin_cli password - "${script_args[@]}"; then
    ok "✅ رمز عبور مدیر تغییر کرد. (رمز نمایش داده نمی‌شود)"
  else
    err "❌ تغییر رمز عبور انجام نشد."
    return 1
  fi
}

valid_domain() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]
}

valid_email() {
  [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$ ]]
}

render_nginx_conf() {
  local domain="$1"
  cat <<EOF
# ساخته‌شده با sulduzx — پنل مدیریت سولدوز
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
EOF
}

pkg_install() {
  if have apt-get; then
    apt-get update -y >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
  elif have dnf; then
    dnf install -y "$@"
  elif have yum; then
    yum install -y "$@"
  else
    die "مدیریت بسته پیدا نشد. بسته‌ها را دستی نصب کنید: $*"
  fi
}

install_nginx() {
  local assume_yes="$1"
  if have nginx; then return 0; fi
  warn "Nginx نصب نیست."
  if [ "$assume_yes" != "1" ] && ! confirm "بسته Nginx نصب شود؟"; then
    die "برای تنظیم دامنه، Nginx لازم است."
  fi
  pkg_install nginx
  systemctl enable --now nginx
}

install_certbot() {
  local assume_yes="$1"
  if have certbot; then return 0; fi
  warn "certbot (برای دریافت خودکار گواهی SSL) نصب نیست."
  if [ "$assume_yes" != "1" ] && ! confirm "بسته certbot و افزونه Nginx نصب شود؟"; then
    die "بدون certbot امکان دریافت خودکار گواهی نیست."
  fi
  pkg_install certbot python3-certbot-nginx
}

# مسیر کانفیگ Nginx: در Debian/Ubuntu از sites-available و در بقیه از conf.d
nginx_conf_paths() {
  if [ -d /etc/nginx/sites-available ]; then
    printf '%s\n%s\n' "/etc/nginx/sites-available/sulduzx" "/etc/nginx/sites-enabled/sulduzx"
  else
    printf '%s\n%s\n' "/etc/nginx/conf.d/sulduzx.conf" ""
  fi
}

cmd_domain() {
  local domain="" email="" staging=0 assume_yes=0 print_only=0 dry=0

  while [ $# -gt 0 ]; do
    case "$1" in
    --domain)
      domain="${2:-}"
      shift 2 || die "مقدار --domain داده نشده"
      ;;
    --email)
      email="${2:-}"
      shift 2 || die "مقدار --email داده نشده"
      ;;
    --staging)
      staging=1
      shift
      ;;
    --yes | -y)
      assume_yes=1
      shift
      ;;
    --print-config)
      print_only=1
      shift
      ;;
    --dry-run)
      dry=1
      shift
      ;;
    -h | --help)
      usage
      return 0
      ;;
    *) die "گزینه ناشناخته: $1" ;;
    esac
  done

  if [ -z "$domain" ]; then
    read_tty "دامنه پنل (مثال: panel.example.com): " domain || return 1
  fi
  domain="$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  domain="${domain#http://}"
  domain="${domain#https://}"
  domain="${domain%%/*}"
  valid_domain "$domain" || die "دامنه نامعتبر است: $domain"

  if [ "$print_only" = "1" ]; then
    render_nginx_conf "$domain"
    return 0
  fi

  if [ -z "$email" ]; then
    read_tty "ایمیل برای Let's Encrypt (برای اطلاع‌رسانی انقضا): " email || return 1
  fi
  valid_email "$email" || die "ایمیل نامعتبر است: $email"

  [ "$(id -u)" -eq 0 ] || die "برای تنظیم دامنه باید با root اجرا شود: sudo sulduzx domain"

  local available enabled
  available="$(nginx_conf_paths | head -n1)"
  enabled="$(nginx_conf_paths | sed -n 2p)"

  if [ "$dry" = "1" ]; then
    info "[dry-run] Nginx: $available"
    render_nginx_conf "$domain"
    info "[dry-run] certbot --nginx -d $domain -m $email --redirect"
    info "[dry-run] ADMIN_PANEL_URL=https://$domain در .env"
    return 0
  fi

  install_nginx "$assume_yes"
  install_certbot "$assume_yes"

  info "📝 نوشتن کانفیگ Nginx (${available})..."
  render_nginx_conf "$domain" >"$available"
  if [ -n "$enabled" ]; then
    mkdir -p "$(dirname "$enabled")"
    ln -sfn "$available" "$enabled"
  fi

  if ! nginx -t; then
    [ -n "$enabled" ] && rm -f "$enabled"
    die "کانفیگ Nginx نامعتبر است؛ فایل $available برای بررسی باقی ماند."
  fi
  systemctl reload nginx
  ok "✅ Nginx برای $domain تنظیم شد."

  info "🔐 دریافت گواهی SSL از Let's Encrypt..."
  local cert_args=(--nginx -d "$domain" --non-interactive --agree-tos -m "$email" --redirect)
  [ "$staging" = "1" ] && cert_args+=(--staging)
  if ! certbot "${cert_args[@]}"; then
    err "دریافت گواهی ناموفق بود."
    err "بررسی کنید دامنه به IP همین سرور اشاره کند و پورت ۸۰ از بیرون باز باشد."
    return 1
  fi
  ok "✅ گواهی SSL نصب شد و HTTPS فعال است."

  if [ -f "$SULDUZX_DIR/.env" ]; then
    set_env ADMIN_PANEL_URL "https://$domain"
    info "♻️  اعمال آدرس پنل در کانتینر ربات..."
    dc up -d bot >/dev/null
    ok "✅ ADMIN_PANEL_URL به https://$domain تغییر کرد."
  else
    warn "فایل .env پیدا نشد؛ ADMIN_PANEL_URL دستی تنظیم شود."
  fi

  echo
  ok "🌐 پنل مدیریت: https://$domain"
  info "برای اطمینان: curl -I https://$domain"
}

cmd_env() {
  require_install
  [ "$(id -u)" -eq 0 ] || die "برای ویرایش .env دسترسی root لازم است: sudo sulduzx env"
  local editor="${EDITOR:-}"
  if [ -z "$editor" ]; then
    if have nano; then editor="nano"; elif have vi; then editor="vi"; else die "ویرایشگر nano/vi پیدا نشد."; fi
  fi
  "$editor" "$SULDUZX_DIR/.env"
  chmod 600 "$SULDUZX_DIR/.env"
  if confirm "برای اعمال تغییرات، کانتینرها ری‌استارت شوند؟"; then
    dc up -d
    ok "✅ سرویس‌ها به‌روزرسانی شدند."
  fi
}

cmd_backup() {
  require_install
  local dir="$SULDUZX_DIR/data/backups" stamp file pguser pgdb
  mkdir -p "$dir"
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="$dir/db-$stamp.sql.gz"
  pguser="$(get_env POSTGRES_USER)"
  pguser="${pguser:-sulduz}"
  pgdb="$(get_env POSTGRES_DB)"
  pgdb="${pgdb:-sulduz_bot}"

  info "💾 در حال گرفتن بکاپ دیتابیس..."
  if ! dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' </dev/null | gzip >"$file"; then
    rm -f "$file"
    die "بکاپ ناموفق بود."
  fi
  ok "✅ بکاپ ساخته شد: $file ($(du -h "$file" | cut -f1))"
}

cmd_update() {
  require_install
  if [ "${1:-}" != "--yes" ] && ! confirm "دریافت نسخه جدید و بیلد مجدد انجام شود؟"; then
    warn "لغو شد."
    return 0
  fi

  if [ -d "$SULDUZX_DIR/.git" ]; then
    info "⬇️  دریافت تغییرات از گیت..."
    git -C "$SULDUZX_DIR" pull --ff-only || warn "git pull ناموفق بود؛ با نسخه فعلی ادامه می‌دهیم."
  else
    warn "مخزن گیت پیدا نشد؛ فقط بیلد مجدد انجام می‌شود."
  fi

  dc build bot admin || die "بیلد ناموفق بود."
  dc up -d || die "اجرای کانتینرها ناموفق بود."
  info "🗄  هم‌سان‌سازی ساختار دیتابیس..."
  dc run --rm --no-deps bot npx prisma db push --skip-generate </dev/null || warn "db push ناموفق بود."
  ok "✅ به‌روزرسانی کامل شد."
}

menu_header() {
  printf '%s' "$C_BOLD$C_CYAN"
  cat <<'EOF'
   ____        _     _             ____ _                 _
  / ___| _   _| | __| |_   _ ____ / ___| | ___  _   _  __| |
  \___ \| | | | |/ _` | | | |_  /| |   | |/ _ \| | | |/ _` |
   ___) | |_| | | (_| | |_| |/ / | |___| | (_) | |_| | (_| |
  |____/ \__,_|_|\__,_|\__,_/___| \____|_|\___/ \__,_|\__,_|
EOF
  printf '%s' "$C_RESET"
  printf '%s           مدیریت سرویس سولدوز — نسخه %s%s\n\n' "$C_DIM" "$SULDUZX_VERSION" "$C_RESET"
}

menu() {
  while true; do
    clear 2>/dev/null || true
    menu_header
    cat <<EOF
  ${C_BOLD}1)${C_RESET} وضعیت سرویس‌ها
  ${C_BOLD}2)${C_RESET} روشن / ری‌استارت
  ${C_BOLD}3)${C_RESET} توقف سرویس‌ها
  ${C_BOLD}4)${C_RESET} مشاهده لاگ‌های ربات
  ${C_BOLD}5)${C_RESET} تغییر نام کاربری مدیر پنل
  ${C_BOLD}6)${C_RESET} تغییر رمز عبور مدیر پنل
  ${C_BOLD}7)${C_RESET} تنظیم دامنه و دریافت SSL خودکار
  ${C_BOLD}8)${C_RESET} ویرایش فایل .env
  ${C_BOLD}9)${C_RESET} بکاپ دستی دیتابیس
  ${C_BOLD}10)${C_RESET} به‌روزرسانی و بیلد مجدد
  ${C_BOLD}0)${C_RESET} خروج
EOF
    echo
    local choice=""
    read_tty "انتخاب کنید: " choice || exit 0
    echo
    case "$choice" in
    1) show_status ;;
    2) cmd_restart ;;
    3) cmd_stop ;;
    4) cmd_logs ;;
    5) cmd_username ;;
    6) cmd_password ;;
    7) cmd_domain ;;
    8) cmd_env ;;
    9) cmd_backup ;;
    10) cmd_update ;;
    0 | q | Q) exit 0 ;;
    *) warn "گزینه نامعتبر است." ;;
    esac
    echo
    read_tty "برای بازگشت به منو Enter بزنید..." _ || true
  done
}

command="${1:-menu}"
[ $# -gt 0 ] && shift

case "$command" in
menu) menu ;;
status) show_status ;;
start) cmd_start ;;
restart) cmd_restart ;;
stop) cmd_stop "$@" ;;
logs) cmd_logs ;;
username) cmd_username "$@" ;;
password) cmd_password "$@" ;;
domain) cmd_domain "$@" ;;
env) cmd_env ;;
backup) cmd_backup ;;
update) cmd_update "$@" ;;
version | --version | -v) echo "sulduzx $SULDUZX_VERSION" ;;
help | --help | -h) usage ;;
*)
  usage
  exit 1
  ;;
esac
