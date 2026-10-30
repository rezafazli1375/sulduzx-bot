#!/usr/bin/env bash
# ============================================================================
#  Sulduz Cloud — نصب‌کننده تک‌دستوری
#
#  نصب:
#    curl -fsSL https://raw.githubusercontent.com/rezafazli1375/sulduzx-bot/main/install.sh | sudo bash
#
#  یا از داخل مخزن:
#    sudo bash install.sh
#
#  گزینه‌ها:
#    --dir <path>        مسیر نصب (پیش‌فرض /opt/sulduz-bot)
#    --domain <name>     دامنه پنل + دریافت خودکار SSL
#    --email <mail>      ایمیل Let's Encrypt
#    --no-ssl            بدون تنظیم دامنه/SSL
#    --yes               بدون پرسش (مقادیر از متغیرهای محیطی)
#    --force-env         بازنویسی .env موجود
#    --repo <url>        مخزن جایگزین
#    --branch <name>     شاخه (پیش‌فرض main)
#    --dry-run           نمایش کارها بدون تغییر سیستم
# ============================================================================
set -Eeuo pipefail

REPO_URL="${SULDUZX_REPO:-https://github.com/rezafazli1375/sulduzx-bot.git}"
BRANCH="${SULDUZX_BRANCH:-main}"
DIR="/opt/sulduz-bot"
DOMAIN=""
EMAIL=""
ASSUME_YES=0
DRY_RUN=0
NO_SSL=0
FORCE_ENV=0

while [ $# -gt 0 ]; do
  case "$1" in
  --dir)
    DIR="${2:-}"
    shift 2 || { echo "مقدار --dir داده نشده"; exit 1; }
    ;;
  --domain)
    DOMAIN="${2:-}"
    shift 2 || { echo "مقدار --domain داده نشده"; exit 1; }
    ;;
  --email)
    EMAIL="${2:-}"
    shift 2 || { echo "مقدار --email داده نشده"; exit 1; }
    ;;
  --no-ssl)
    NO_SSL=1
    shift
    ;;
  --yes | -y)
    ASSUME_YES=1
    shift
    ;;
  --force-env)
    FORCE_ENV=1
    shift
    ;;
  --repo)
    REPO_URL="${2:-}"
    shift 2 || { echo "مقدار --repo داده نشده"; exit 1; }
    ;;
  --branch)
    BRANCH="${2:-}"
    shift 2 || { echo "مقدار --branch داده نشده"; exit 1; }
    ;;
  --dry-run)
    DRY_RUN=1
    shift
    ;;
  -h | --help)
    cat <<'HELP'
Sulduz Cloud — نصب‌کننده تک‌دستوری

نصب:
  curl -fsSL https://raw.githubusercontent.com/rezafazli1375/sulduzx-bot/main/install.sh | sudo bash
  sudo bash install.sh

گزینه‌ها:
  --dir <path>        مسیر نصب (پیش‌فرض /opt/sulduz-bot)
  --domain <name>     دامنه پنل + دریافت خودکار SSL
  --email <mail>      ایمیل Let's Encrypt
  --no-ssl            بدون تنظیم دامنه/SSL
  --yes               بدون پرسش (مقادیر از متغیرهای محیطی)
  --force-env         بازنویسی .env موجود
  --repo <url>        مخزن جایگزین
  --branch <name>     شاخه (پیش‌فرض main)
  --dry-run           نمایش کارها بدون تغییر سیستم

نصب غیرتعاملی (بدون ترمینال/با متغیر محیطی):
  BOT_TOKEN=... ADMIN_IDS=... sudo -E bash install.sh --yes --domain example.com --email you@example.com

متغیرهای محیطی شناخته‌شده:
  BOT_TOKEN, BOT_USERNAME, ADMIN_IDS, PANEL_BASE_URL, PANEL_USERNAME,
  PANEL_PASSWORD, PANEL_INBOUND_ID, ADMIN_USERNAME, ADMIN_PASSWORD, YTDLP_PROXY
HELP
    exit 0
    ;;
  *)
    echo "گزینه ناشناخته: $1"
    exit 1
    ;;
  esac
done

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

info() { printf '%s▸ %s%s\n' "$C_CYAN" "$*" "$C_RESET"; }
ok() { printf '%s✔ %s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
warn() { printf '%s! %s%s\n' "$C_YELLOW" "$*" "$C_RESET"; }
err() { printf '%s✘ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; }
die() {
  err "$*"
  exit 1
}
have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(id -u)" -ne 0 ]; then
  die "این نصب‌کننده نیاز به دسترسی root دارد. با sudo اجرا کنید."
fi

HAS_TTY=0
if { : </dev/tty; } 2>/dev/null; then HAS_TTY=1; fi

ask() {
  local prompt="$1" default="${2:-}" answer=""
  if [ "$ASSUME_YES" != "1" ] && [ "$HAS_TTY" = "1" ]; then
    if [ -n "$default" ]; then
      read -r -p "$prompt [$default]: " answer </dev/tty || answer=""
    else
      read -r -p "$prompt: " answer </dev/tty || answer=""
    fi
  fi
  printf '%s' "${answer:-$default}"
}

ask_secret() {
  local prompt="$1" answer=""
  if [ "$ASSUME_YES" != "1" ] && [ "$HAS_TTY" = "1" ]; then
    read -r -s -p "$prompt: " answer </dev/tty || answer=""
    printf '\n'
  fi
  printf '%s' "$answer"
}

confirm() {
  local prompt="$1" answer=""
  if [ "$ASSUME_YES" = "1" ]; then return 0; fi
  [ "$HAS_TTY" = "1" ] || return 1
  read -r -p "$prompt [y/N] " answer </dev/tty || answer=""
  case "$answer" in
  y | Y | yes | YES | بله) return 0 ;;
  *) return 1 ;;
  esac
}

apt_install() {
  if [ "$DRY_RUN" = "1" ]; then
    info "[dry-run] نصب بسته‌ها: $*"
    return 0
  fi
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

ensure_base_tools() {
  local missing=()
  have curl || missing+=(curl)
  have tar || missing+=(tar)
  have openssl || missing+=(openssl)
  if [ ${#missing[@]} -gt 0 ]; then
    warn "ابزارهای لازم نصب نیستند: ${missing[*]}"
    confirm "نصب آن‌ها انجام شود؟" || die "بدون ${missing[*]} ادامه ممکن نیست."
    apt_install "${missing[@]}"
  fi
}

ensure_git() {
  have git && return 0
  warn "git نصب نیست."
  confirm "نصب git انجام شود؟" || die "برای دریافت پروژه، git لازم است."
  apt_install git
}

ensure_docker() {
  if have docker; then
    if ! docker compose version >/dev/null 2>&1; then
      warn "افزونه Docker Compose پیدا نشد."
      confirm "نصب docker-compose-plugin انجام شود؟" || die "Docker Compose لازم است."
      apt_install docker-compose-plugin
    fi
    return 0
  fi

  warn "Docker نصب نیست."
  confirm "Docker از مخزن رسمی (get.docker.com) نصب شود؟" || die "Docker برای اجرای پروژه لازم است."
  if [ "$DRY_RUN" = "1" ]; then
    info "[dry-run] curl -fsSL https://get.docker.com | sh"
    return 0
  fi
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
}

dc() {
  docker compose --project-directory "$DIR" --env-file "$DIR/.env" "$@"
}

grep_env() {
  local key="$1" file="$2" value=""
  [ -f "$file" ] || return 0
  value="$(grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2-)"
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

env_quote() {
  local v="$1"
  v="${v//$'\r'/}"
  v="${v//$'\n'/}"
  case "$v" in
  *[[:space:]\#\"\'\\\$]*)
    v="${v//\\/\\\\}"
    v="${v//\"/\\\"}"
    v="${v//\$/\\\$}"
    printf '"%s"' "$v"
    ;;
  *) printf '%s' "$v" ;;
  esac
}

valid_bot_token() { [[ "$1" =~ ^[0-9]{5,}:[A-Za-z0-9_-]{20,}$ ]]; }
valid_admin_ids() { [[ "$1" =~ ^[0-9]+(,[0-9]+)*$ ]]; }
valid_username() { [[ "$1" =~ ^[A-Za-z0-9._-]{3,32}$ ]]; }
valid_email() { [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$ ]]; }
valid_domain() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]; }

gen_password() { openssl rand -hex 8; }
gen_secret() { openssl rand -hex 32; }

public_ip() {
  local ip=""
  ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$ip" ]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "$ip"
}

printf '\n%s%s Sulduz Cloud — نصب خودکار %s\n\n' "$C_BOLD" "$C_CYAN" "$C_RESET"

if [ "$DRY_RUN" = "1" ]; then
  warn "حالت آزمایشی (--dry-run): هیچ تغییری روی سیستم اعمال نمی‌شود."
fi

# ---------------------------------------------------------------- prerequisites
info "بررسی پیش‌نیازها..."
ensure_base_tools
ensure_docker

# ---------------------------------------------------------------- source
SELF_PATH="${BASH_SOURCE[0]:-}"
if [ -n "$SELF_PATH" ] && [ -f "$SELF_PATH" ]; then
  SELF_DIR="$(cd "$(dirname "$SELF_PATH")" && pwd)"
else
  SELF_DIR="$(pwd)"
fi

TMP_DIR=""
SRC_IS_CLONE=0
if [ -f "$SELF_DIR/packages/bot/Dockerfile" ] && [ -f "$SELF_DIR/docker-compose.yml" ]; then
  SRC_DIR="$SELF_DIR"
  info "استفاده از فایل‌های محلی: $SRC_DIR"
else
  ensure_git
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  info "دریافت پروژه از GitHub..."
  if [ "$DRY_RUN" = "1" ]; then
    info "[dry-run] git clone --depth 1 --branch $BRANCH $REPO_URL"
    SRC_DIR="$TMP_DIR/src"
  else
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP_DIR/src" >/dev/null 2>&1 ||
      die "دریافت پروژه از GitHub ناموفق بود: $REPO_URL"
    SRC_DIR="$TMP_DIR/src"
    SRC_IS_CLONE=1
  fi
fi

# ---------------------------------------------------------------- answers
ENV_FILE="$DIR/.env"
REUSE_ENV=0
if [ -f "$ENV_FILE" ] && [ "$FORCE_ENV" != "1" ]; then
  if [ "$ASSUME_YES" = "1" ] || confirm "فایل .env موجود است؛ مقادیر فعلی حفظ شود؟"; then
    REUSE_ENV=1
    ok "مقادیر .env فعلی استفاده می‌شود."
  fi
fi

if [ "$REUSE_ENV" = "1" ]; then
  BOT_TOKEN="${BOT_TOKEN:-$(grep_env BOT_TOKEN "$ENV_FILE")}"
  BOT_USERNAME="${BOT_USERNAME:-$(grep_env BOT_USERNAME "$ENV_FILE")}"
  ADMIN_IDS="${ADMIN_IDS:-$(grep_env ADMIN_IDS "$ENV_FILE")}"
  PGUSER="${POSTGRES_USER:-$(grep_env POSTGRES_USER "$ENV_FILE")}"
  PGPASS="${POSTGRES_PASSWORD:-$(grep_env POSTGRES_PASSWORD "$ENV_FILE")}"
  PGDB="${POSTGRES_DB:-$(grep_env POSTGRES_DB "$ENV_FILE")}"
  DATABASE_URL="${DATABASE_URL:-$(grep_env DATABASE_URL "$ENV_FILE")}"
  PANEL_BASE_URL="${PANEL_BASE_URL:-$(grep_env PANEL_BASE_URL "$ENV_FILE")}"
  PANEL_USERNAME="${PANEL_USERNAME:-$(grep_env PANEL_USERNAME "$ENV_FILE")}"
  PANEL_PASSWORD="${PANEL_PASSWORD:-$(grep_env PANEL_PASSWORD "$ENV_FILE")}"
  PANEL_INBOUND_ID="${PANEL_INBOUND_ID:-$(grep_env PANEL_INBOUND_ID "$ENV_FILE")}"
  JWT_SECRET="${JWT_SECRET:-$(grep_env JWT_SECRET "$ENV_FILE")}"
  ADMIN_USERNAME="${ADMIN_USERNAME:-$(grep_env ADMIN_USERNAME "$ENV_FILE")}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(grep_env ADMIN_PASSWORD "$ENV_FILE")}"
  ADMIN_PANEL_URL="${ADMIN_PANEL_URL:-$(grep_env ADMIN_PANEL_URL "$ENV_FILE")}"
else
  echo
  echo "${C_BOLD}اطلاعات ربات و پنل${C_RESET} (مقادیر در .env ذخیره می‌شوند)"
  BOT_TOKEN="${BOT_TOKEN:-}"
  [ -z "$BOT_TOKEN" ] && BOT_TOKEN="$(ask 'توکن ربات از BotFather')"
  BOT_USERNAME="${BOT_USERNAME:-$(ask 'یوزرنیم ربات (بدون @، اختیاری)')}"
  ADMIN_IDS="${ADMIN_IDS:-}"
  [ -z "$ADMIN_IDS" ] && ADMIN_IDS="$(ask 'آیدی عددی ادمین‌ها (با کاما جدا کنید)')"

  echo
  PANEL_BASE_URL="${PANEL_BASE_URL:-$(ask 'آدرس پنل 3x-ui (اختیاری، بعداً هم قابل تنظیم است)')}"
  PANEL_USERNAME="${PANEL_USERNAME:-$(ask 'نام کاربری پنل 3x-ui (اختیاری)')}"
  PANEL_PASSWORD="${PANEL_PASSWORD:-$(ask_secret 'رمز پنل 3x-ui (اختیاری)')}"
  PANEL_INBOUND_ID="${PANEL_INBOUND_ID:-$(ask 'شناسه inbound کانفیگ‌ها' '11')}"

  echo
  ADMIN_USERNAME="${ADMIN_USERNAME:-$(ask 'نام کاربری مدیر پنل' 'admin')}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
  if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="$(gen_password)"
    warn "رمز مدیر به‌صورت خودکار ساخته شد (در پایان نمایش داده می‌شود)."
  fi
fi

PGUSER="${PGUSER:-sulduz}"
PGDB="${PGDB:-sulduz_bot}"
PGPASS="${PGPASS:-$(gen_password)}"
JWT_SECRET="${JWT_SECRET:-$(gen_secret)}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(gen_password)}"
PANEL_INBOUND_ID="${PANEL_INBOUND_ID:-11}"
DATABASE_URL="${DATABASE_URL:-postgresql://${PGUSER}:${PGPASS}@postgres:5432/${PGDB}?schema=public}"

# ---------------------------------------------------------------- validation
if [ "$DRY_RUN" = "1" ]; then
  [ -z "$BOT_TOKEN" ] && BOT_TOKEN="123456789:DRYRUNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  [ -z "$ADMIN_IDS" ] && ADMIN_IDS="123456789"
  [ -z "$DOMAIN" ] && DOMAIN="panel.example.com"
  [ -z "$EMAIL" ] && EMAIL="admin@example.com"
fi

if [ "$HAS_TTY" = "0" ] && [ "$ASSUME_YES" != "1" ] &&
  { ! valid_bot_token "$BOT_TOKEN" || ! valid_admin_ids "$ADMIN_IDS"; }; then
  die "ترمینال تعاملی در دسترس نیست. BOT_TOKEN و ADMIN_IDS را با متغیر محیطی بدهید (sudo -E bash) یا اسکریپت را در یک ترمینال SSH اجرا کنید."
fi
valid_bot_token "$BOT_TOKEN" || {
  [ "$DRY_RUN" = "1" ] || die "توکن ربات نامعتبر است. نمونه: 123456789:AA..."
}
valid_admin_ids "$ADMIN_IDS" || die "ADMIN_IDS باید فقط شامل عدد و کاما باشد."
valid_username "$ADMIN_USERNAME" || die "نام کاربری مدیر باید ۳ تا ۳۲ نویسه و شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد."
[ ${#ADMIN_PASSWORD} -ge 8 ] || die "رمز مدیر باید حداقل ۸ نویسه باشد."

if [ -n "$DOMAIN" ]; then
  DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  valid_domain "$DOMAIN" || die "دامنه نامعتبر است: $DOMAIN"
  if [ -z "$EMAIL" ]; then
    EMAIL="$(ask 'ایمیل Let'"'"'s Encrypt')"
  fi
  [ -z "$EMAIL" ] || valid_email "$EMAIL" || die "ایمیل نامعتبر است: $EMAIL"
  DETECTED_PANEL_URL="https://${DOMAIN}"
else
  DETECTED_PANEL_URL="${ADMIN_PANEL_URL:-}"
  if [ -z "$DETECTED_PANEL_URL" ] && [ "$DRY_RUN" != "1" ]; then
    DETECTED_PANEL_URL="http://$(public_ip):9090"
  fi
  DETECTED_PANEL_URL="${DETECTED_PANEL_URL:-http://SERVER_IP:9090}"
fi

# ---------------------------------------------------------------- copy files
info "آماده‌سازی مسیر $DIR ..."
if [ "$DRY_RUN" = "1" ]; then
  info "[dry-run] کپی فایل‌ها از $SRC_DIR به $DIR"
else
  mkdir -p "$DIR"
  if [ "$SRC_DIR" != "$DIR" ]; then
    tar -C "$SRC_DIR" \
      --exclude=node_modules --exclude=dist --exclude=data --exclude=backups \
      --exclude=.env --exclude='*.log' \
      -cf - . | tar -C "$DIR" -xf -
  fi
fi

# ---------------------------------------------------------------- write .env
if [ "$DRY_RUN" = "1" ]; then
  info "[dry-run] نوشتن $ENV_FILE (chmod 600)"
elif [ "$REUSE_ENV" = "1" ]; then
  chmod 600 "$ENV_FILE"
  mkdir -p "$DIR/data/backups"
  ok "فایل .env موجود حفظ شد."
else
  umask 077
  cat >"$ENV_FILE" <<EOF
# Sulduz Cloud — ساخته‌شده با install.sh
BOT_TOKEN=$(env_quote "$BOT_TOKEN")
BOT_USERNAME=$(env_quote "$BOT_USERNAME")
ADMIN_IDS=$(env_quote "$ADMIN_IDS")

POSTGRES_USER=$(env_quote "$PGUSER")
POSTGRES_PASSWORD=$(env_quote "$PGPASS")
POSTGRES_DB=$(env_quote "$PGDB")
DATABASE_URL=$(env_quote "$DATABASE_URL")

PANEL_BASE_URL=$(env_quote "$PANEL_BASE_URL")
PANEL_USERNAME=$(env_quote "$PANEL_USERNAME")
PANEL_PASSWORD=$(env_quote "$PANEL_PASSWORD")
PANEL_INBOUND_ID=$(env_quote "$PANEL_INBOUND_ID")

JWT_SECRET=$(env_quote "$JWT_SECRET")
ADMIN_USERNAME=$(env_quote "$ADMIN_USERNAME")
ADMIN_PASSWORD=$(env_quote "$ADMIN_PASSWORD")

PORT=3000
NODE_ENV=production
TZ=$(env_quote "${TZ:-Asia/Tehran}")
ADMIN_PANEL_URL=$(env_quote "$DETECTED_PANEL_URL")
YTDLP_PROXY=$(env_quote "${YTDLP_PROXY:-}")
EOF
  chmod 600 "$ENV_FILE"
  mkdir -p "$DIR/data/backups"
  ok "فایل .env ساخته شد."
fi

# ---------------------------------------------------------------- build & run
if [ "$DRY_RUN" = "1" ]; then
  info "[dry-run] docker compose build"
  info "[dry-run] docker compose up -d postgres"
  info "[dry-run] prisma db push + db:seed"
  info "[dry-run] docker compose up -d"
  info "[dry-run] نصب /usr/local/bin/sulduzx"
  [ -n "$DOMAIN" ] && info "[dry-run] sulduzx domain --domain $DOMAIN --email $EMAIL --yes"
  printf '\n%s✔ بررسی --dry-run تمام شد؛ هیچ تغییری اعمال نشد.%s\n\n' "$C_GREEN" "$C_RESET"
  exit 0
fi

if [ ! -f "$SRC_DIR/packages/bot/Dockerfile" ] && [ "$SRC_IS_CLONE" = "1" ]; then
  die "منبع پروژه معتبر نیست."
fi

info "ساخت ایمیج‌ها (چند دقیقه طول می‌کشد)..."
dc build

info "راه‌اندازی دیتابیس..."
dc up -d postgres
for _ in $(seq 1 30); do
  if dc exec -T postgres pg_isready -U "$PGUSER" -d "$PGDB" </dev/null >/dev/null 2>&1; then break; fi
  sleep 2
done

info "ساخت ساختار دیتابیس..."
dc run --rm --no-deps bot npx prisma db push --skip-generate </dev/null

info "درج داده‌های اولیه (ادمین و تنظیمات)..."
dc run --rm --no-deps \
  -e ADMIN_USERNAME="$ADMIN_USERNAME" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  bot npm run db:seed </dev/null

info "اجرای سرویس‌ها..."
dc up -d

PANEL_READY=0
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:9090/ 2>/dev/null; then
    PANEL_READY=1
    break
  fi
  sleep 2
done
if [ "$PANEL_READY" = "1" ]; then
  ok "پنل مدیریت پاسخ می‌دهد."
else
  warn "پنل هنوز پاسخ نمی‌دهد؛ با «sulduzx logs» لاگ‌ها را ببینید."
fi

# ---------------------------------------------------------------- sulduzx CLI
info "نصب دستور مدیریت sulduzx ..."
install -m 0755 "$DIR/scripts/sulduzx.sh" /usr/local/bin/sulduzx
printf 'SULDUZX_DIR="%s"\n' "$DIR" >/etc/sulduzx.conf
chmod 644 /etc/sulduzx.conf
cat >/etc/profile.d/99-sulduz-menu.sh <<'EOF'
if [ -n "${PS1:-}" ] && [ -t 0 ] && command -v sulduzx >/dev/null 2>&1; then
  echo "برای مدیریت سرویس سولدوز دستور «sulduzx» را بزنید."
fi
EOF
chmod 644 /etc/profile.d/99-sulduz-menu.sh
ok "دستور sulduzx نصب شد."

# ---------------------------------------------------------------- domain/SSL
if [ "$NO_SSL" != "1" ] && [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
  echo
  info "تنظیم دامنه و دریافت گواهی SSL ..."
  if /usr/local/bin/sulduzx domain --domain "$DOMAIN" --email "$EMAIL" --yes; then
    ok "HTTPS فعال شد."
  else
    warn "تنظیم دامنه/SSL ناموفق بود. بعداً از منوی «sulduzx» گزینه ۷ را اجرا کنید."
  fi
fi

# ---------------------------------------------------------------- summary
PANEL_URL="$DETECTED_PANEL_URL"
if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
  PANEL_URL="https://$DOMAIN"
fi

printf '\n%s%s════════════ نصب کامل شد ════════════%s\n\n' "$C_BOLD" "$C_GREEN" "$C_RESET"
printf '  %sپنل مدیریت:%s %s\n' "$C_BOLD" "$C_RESET" "$PANEL_URL"
printf '  %sنام کاربری:%s %s\n' "$C_BOLD" "$C_RESET" "$ADMIN_USERNAME"
printf '  %sرمز عبور:%s %s\n' "$C_BOLD" "$C_RESET" "$ADMIN_PASSWORD"
printf '  %sمسیر نصب:%s %s\n' "$C_BOLD" "$C_RESET" "$DIR"
printf '  %sمدیریت:%s sulduzx\n' "$C_BOLD" "$C_RESET"
echo
warn "رمز عبور فقط همین یک‌بار نمایش داده می‌شود؛ آن را در جای امن ذخیره کنید."
warn "برای تغییر نام کاربری یا رمز: sulduzx → گزینه ۵ یا ۶"
echo
