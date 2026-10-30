#!/usr/bin/env bash
# Sulduz Cloud — SSH management menu
# install.sh installs this file as /usr/local/bin/sulduzx.
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

Usage: sulduzx [command]

Commands:
  sulduzx                     interactive menu
  sulduzx status              container status and API health
  sulduzx start | restart     start / restart services
  sulduzx stop                stop services
  sulduzx logs                follow bot logs
  sulduzx username <name>     change the panel admin username
  sulduzx password            change the panel admin password (interactive or stdin)
                              use --user <current-name> to target a specific admin
  sulduzx domain              set up the domain and automatic SSL
  sulduzx env                 edit the .env file
  sulduzx backup              manual database backup
  sulduzx update              pull latest version and rebuild
  sulduzx help                this help

domain options:
  --domain example.com --email you@example.com   run without prompts
  --staging        use the Let's Encrypt staging server
  --print-config   only print the Nginx config (no changes)
  --dry-run        show actions without applying changes
  --yes            auto-approve prerequisite installs

Install path: ${SULDUZX_DIR}
EOF
}

have() { command -v "$1" >/dev/null 2>&1; }

require_install() {
  have docker || die "Docker is not installed. Run install.sh first."
  [ -d "$SULDUZX_DIR" ] || die "Install path not found: $SULDUZX_DIR"
  [ -f "$SULDUZX_DIR/docker-compose.yml" ] || die "docker-compose.yml not found in $SULDUZX_DIR"
  [ -f "$SULDUZX_DIR/.env" ] || die ".env not found in $SULDUZX_DIR"
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
  [ -f "$file" ] || die ".env not found: $file"
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
  y | Y | yes | YES) return 0 ;;
  *) return 1 ;;
  esac
}

bot_running() {
  [ -n "$(dc ps --status running -q bot 2>/dev/null)" ]
}

# Runs admin-cli inside the container; injects the script if the image is older.
admin_cli() {
  local script="$SULDUZX_DIR/packages/bot/scripts/admin-cli.mjs"
  [ -f "$script" ] || die "File not found: $script"
  bot_running || die "Bot container is not running. Run: sulduzx start"

  if dc exec -T bot test -f /app/scripts/admin-cli.mjs </dev/null >/dev/null 2>&1; then
    dc exec -T -w /app bot node /app/scripts/admin-cli.mjs "$@"
    return $?
  fi

  dc exec -T bot sh -c 'cat > /app/.admin-cli.mjs' <"$script" || return 1
  dc exec -T -w /app bot node /app/.admin-cli.mjs "$@"
}

show_status() {
  require_install
  info "Install path: $SULDUZX_DIR"
  echo
  dc ps || true
  echo

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/api/health 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    ok "Bot API: healthy (HTTP 200)"
  else
    err "Bot API: bad response (${code:-no response})"
  fi

  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:9090/ 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    ok "Local admin panel: healthy (HTTP 200)"
  else
    err "Local admin panel: bad response (${code:-no response})"
  fi

  local panel_url
  panel_url="$(get_env ADMIN_PANEL_URL)"
  [ -n "$panel_url" ] && info "Public panel URL: $panel_url"
  return 0
}

cmd_start() {
  require_install
  dc up -d
  ok "Services started."
  show_status
}

cmd_restart() {
  require_install
  dc up -d
  dc restart bot admin
  ok "Services restarted."
  show_status
}

cmd_stop() {
  require_install
  if [ "${1:-}" != "--yes" ] && ! confirm "Stop all services?"; then
    warn "Cancelled."
    return 0
  fi
  dc stop
  ok "Services stopped. Data is left untouched."
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
      shift 2 || die "Missing value for --user"
      ;;
    -*) die "Unknown option: $1" ;;
    *)
      if [ -z "$next" ]; then
        next="$1"
        shift
      else
        die "Unexpected argument: $1"
      fi
      ;;
    esac
  done

  if [ -z "$next" ]; then
    read_tty "New username (3-32 chars, letters/digits/. _ -): " next || return 1
  fi
  next="$(printf '%s' "$next" | tr -d '[:space:]')"
  [[ "$next" =~ ^[A-Za-z0-9._-]{3,32}$ ]] || die "Invalid username."
  [ -n "$current" ] && script_args+=(--user "$current")

  if admin_cli username "$next" "${script_args[@]}"; then
    set_env ADMIN_USERNAME "$next"
    ok "Username updated in .env as well."
  else
    err "Username change failed."
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
      shift 2 || die "Missing value for --user"
      ;;
    -*) die "Unknown option: $1" ;;
    *)
      if [ -z "$pass" ]; then
        pass="$1"
        shift
      else
        die "Unexpected argument: $1"
      fi
      ;;
    esac
  done
  [ -n "$current" ] && script_args+=(--user "$current")

  if [ -z "$pass" ]; then
    if [ -t 0 ]; then
      local pass2=""
      while true; do
        read_secret "New password (min 8 chars): " pass
        [ ${#pass} -ge 8 ] || {
          warn "Password too short."
          continue
        }
        read_secret "Repeat new password: " pass2
        [ "$pass" = "$pass2" ] || {
          warn "Passwords do not match."
          continue
        }
        break
      done
    else
      IFS= read -r pass || true
    fi
  fi

  [ ${#pass} -ge 8 ] || die "Password must be at least 8 characters."

  if printf '%s' "$pass" | admin_cli password - "${script_args[@]}"; then
    ok "Admin password changed. (password is not displayed)"
  else
    err "Password change failed."
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
# Generated by sulduzx — Sulduz Cloud admin panel
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
    die "No package manager found. Install manually: $*"
  fi
}

install_nginx() {
  local assume_yes="$1"
  if have nginx; then return 0; fi
  warn "Nginx is not installed."
  if [ "$assume_yes" != "1" ] && ! confirm "Install the Nginx package?"; then
    die "Nginx is required for domain setup."
  fi
  pkg_install nginx
  systemctl enable --now nginx
}

install_certbot() {
  local assume_yes="$1"
  if have certbot; then return 0; fi
  warn "certbot (automatic SSL) is not installed."
  if [ "$assume_yes" != "1" ] && ! confirm "Install certbot and the Nginx plugin?"; then
    die "Automated certificates require certbot."
  fi
  pkg_install certbot python3-certbot-nginx
}

# Nginx config path: Debian/Ubuntu use sites-available, others use conf.d
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
      shift 2 || die "Missing value for --domain"
      ;;
    --email)
      email="${2:-}"
      shift 2 || die "Missing value for --email"
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
    *) die "Unknown option: $1" ;;
    esac
  done

  if [ -z "$domain" ]; then
    read_tty "Panel domain (e.g. panel.example.com): " domain || return 1
  fi
  domain="$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  domain="${domain#http://}"
  domain="${domain#https://}"
  domain="${domain%%/*}"
  valid_domain "$domain" || die "Invalid domain: $domain"

  if [ "$print_only" = "1" ]; then
    render_nginx_conf "$domain"
    return 0
  fi

  if [ -z "$email" ]; then
    read_tty "Email for Let's Encrypt (expiry notices): " email || return 1
  fi
  valid_email "$email" || die "Invalid email: $email"

  [ "$(id -u)" -eq 0 ] || die "Domain setup must run as root: sudo sulduzx domain"

  local available enabled
  available="$(nginx_conf_paths | head -n1)"
  enabled="$(nginx_conf_paths | sed -n 2p)"

  if [ "$dry" = "1" ]; then
    info "[dry-run] Nginx: $available"
    render_nginx_conf "$domain"
    info "[dry-run] certbot --nginx -d $domain -m $email --redirect"
    info "[dry-run] ADMIN_PANEL_URL=https://$domain in .env"
    return 0
  fi

  install_nginx "$assume_yes"
  install_certbot "$assume_yes"

  info "Writing Nginx config (${available})..."
  render_nginx_conf "$domain" >"$available"
  if [ -n "$enabled" ]; then
    mkdir -p "$(dirname "$enabled")"
    ln -sfn "$available" "$enabled"
  fi

  if ! nginx -t; then
    [ -n "$enabled" ] && rm -f "$enabled"
    die "Invalid Nginx config; file left at $available for inspection."
  fi
  systemctl reload nginx
  ok "Nginx configured for $domain."

  info "Requesting SSL certificate from Let's Encrypt..."
  local cert_args=(--nginx -d "$domain" --non-interactive --agree-tos -m "$email" --redirect)
  [ "$staging" = "1" ] && cert_args+=(--staging)
  if ! certbot "${cert_args[@]}"; then
    err "Certificate request failed."
    err "Make sure the domain points to this server and port 80 is reachable from outside."
    return 1
  fi
  ok "SSL certificate installed; HTTPS is active."

  if [ -f "$SULDUZX_DIR/.env" ]; then
    set_env ADMIN_PANEL_URL "https://$domain"
    info "Applying the panel URL in the bot container..."
    dc up -d bot >/dev/null
    ok "ADMIN_PANEL_URL set to https://$domain."
  else
    warn ".env not found; set ADMIN_PANEL_URL manually."
  fi

  echo
  ok "Admin panel: https://$domain"
  info "To verify: curl -I https://$domain"
}

cmd_env() {
  require_install
  [ "$(id -u)" -eq 0 ] || die "Root is required to edit .env: sudo sulduzx env"
  local editor="${EDITOR:-}"
  if [ -z "$editor" ]; then
    if have nano; then editor="nano"; elif have vi; then editor="vi"; else die "No editor found (nano/vi)."; fi
  fi
  "$editor" "$SULDUZX_DIR/.env"
  chmod 600 "$SULDUZX_DIR/.env"
  if confirm "Restart containers to apply the changes?"; then
    dc up -d
    ok "Services updated."
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

  info "Creating database backup..."
  if ! dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' </dev/null | gzip >"$file"; then
    rm -f "$file"
    die "Backup failed."
  fi
  ok "Backup created: $file ($(du -h "$file" | cut -f1))"
}

cmd_update() {
  require_install
  if [ "${1:-}" != "--yes" ] && ! confirm "Pull the latest version and rebuild?"; then
    warn "Cancelled."
    return 0
  fi

  if [ -d "$SULDUZX_DIR/.git" ]; then
    info "Pulling changes from git..."
    git -C "$SULDUZX_DIR" pull --ff-only || warn "git pull failed; continuing with the current version."
  else
    warn "No git repository found; rebuilding only."
  fi

  dc build bot admin || die "Build failed."
  dc up -d || die "Failed to start containers."
  info "Syncing database schema..."
  dc run --rm --no-deps bot npx prisma db push --skip-generate </dev/null || warn "db push failed."
  ok "Update complete."
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
  printf '%s           Sulduz Cloud service manager — v%s%s\n\n' "$C_DIM" "$SULDUZX_VERSION" "$C_RESET"
}

menu() {
  while true; do
    clear 2>/dev/null || true
    menu_header
    cat <<EOF
  ${C_BOLD}1)${C_RESET} Service status
  ${C_BOLD}2)${C_RESET} Start / restart
  ${C_BOLD}3)${C_RESET} Stop services
  ${C_BOLD}4)${C_RESET} Bot logs
  ${C_BOLD}5)${C_RESET} Change panel admin username
  ${C_BOLD}6)${C_RESET} Change panel admin password
  ${C_BOLD}7)${C_RESET} Set domain and automatic SSL
  ${C_BOLD}8)${C_RESET} Edit .env
  ${C_BOLD}9)${C_RESET} Manual database backup
  ${C_BOLD}10)${C_RESET} Update and rebuild
  ${C_BOLD}0)${C_RESET} Exit
EOF
    echo
    local choice=""
    read_tty "Select an option: " choice || exit 0
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
    *) warn "Invalid option." ;;
    esac
    echo
    read_tty "Press Enter to return to the menu..." _ || true
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
