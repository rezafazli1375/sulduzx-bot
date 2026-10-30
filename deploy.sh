#!/usr/bin/env bash
# این اسکریپت قدیمی است و فقط برای سازگاری نگه داشته شده.
# نصب‌کننده اصلی install.sh است (تک‌دستوری، با منوی suldux).
set -e

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

if [ -n "${DOMAIN:-}" ]; then
  exec bash "$SELF_DIR/install.sh" --domain "$DOMAIN" "$@"
fi

exec bash "$SELF_DIR/install.sh" "$@"
