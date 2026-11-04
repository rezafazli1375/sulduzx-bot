# -*- coding: utf-8 -*-
"""
ذخیره‌سازی محلی سرویس ویس‌کال.

همه‌چیز زیر /app/voice روی volume سرور می‌نشیند (data/voice) و هیچ‌کدام
در دیتابیس یا مخزن گیت نمی‌رود:
  config.json   → API_ID / API_HASH (فقط روی سرور، فایل ۰۶۰۰)
  accounts.json → فهرست حساب‌های تلگرام (شماره، برچسب، دی‌سی، وضعیت)
  sessions/     → رشتهٔ سشن هر حساب (۰۶۰۰؛ کلیدِ ورود به آن حساب است)
کتابخانهٔ آهنگ‌ها از /app/music به‌صورت فقط‌خواندنی دیده می‌شود.
"""
import json
import os
import re
import secrets
import stat
import time
import uuid

VOICE_HOME = os.environ.get("VOICE_HOME", "/app/voice")
MUSIC_ROOT = os.environ.get("MUSIC_DIR", "/app/music")

CONFIG_PATH = os.path.join(VOICE_HOME, "config.json")
ACCOUNTS_PATH = os.path.join(VOICE_HOME, "accounts.json")
SESSION_DIR = os.path.join(VOICE_HOME, "sessions")

PHONE_RE = re.compile(r"^\+?[0-9]{6,18}$")


def now() -> float:
    return time.time()


def _write_private(path: str, text: str) -> None:
    """فایل با دسترسی ۰۶۰۰ می‌نویسد (سشن و کلید API نباید خواندنی باشند)."""
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    tmp = f"{path}.tmp.{secrets.token_hex(3)}"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    os.replace(tmp, path)


def ensure_dirs() -> None:
    os.makedirs(SESSION_DIR, exist_ok=True)
    os.chmod(VOICE_HOME, 0o700)
    os.chmod(SESSION_DIR, 0o700)


# ─── کلید API ────────────────────────────────
def load_config() -> dict:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def save_config(api_id: int, api_hash: str) -> dict:
    data = {"apiId": int(api_id), "apiHash": api_hash.strip().lower(), "updatedAt": now()}
    _write_private(CONFIG_PATH, json.dumps(data, ensure_ascii=False))
    return data


def clear_config() -> None:
    try:
        os.unlink(CONFIG_PATH)
    except OSError:
        pass


def has_api_keys() -> bool:
    cfg = load_config()
    return bool(cfg.get("apiId")) and bool(cfg.get("apiHash"))


def mask_api_id() -> str:
    cfg = load_config()
    value = str(cfg.get("apiId") or "")
    if not value:
        return ""
    return f"{value[:2]}…{value[-2:]}" if len(value) > 4 else "••••"


# ─── حساب‌ها ─────────────────────────────────
def list_accounts() -> list:
    try:
        with open(ACCOUNTS_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def _save_accounts(accounts: list) -> None:
    _write_private(ACCOUNTS_PATH, json.dumps(accounts, ensure_ascii=False, indent=1))


def get_account(account_id: str) -> dict | None:
    for item in list_accounts():
        if str(item.get("id")) == str(account_id):
            return item
    return None


def upsert_account(account: dict) -> dict:
    accounts = list_accounts()
    for index, item in enumerate(accounts):
        if str(item.get("id")) == str(account.get("id")):
            accounts[index] = {**item, **account}
            break
    else:
        accounts.append(account)
    _save_accounts(accounts)
    return account


def create_account(phone: str, label: str = "") -> dict:
    account = {
        "id": uuid.uuid4().hex[:12],
        "phone": phone,
        "label": label or "",
        "createdAt": now(),
        "updatedAt": now(),
        "userId": None,
        "username": None,
        "firstName": None,
        "dcId": None,
        "premium": False,
        "status": "pending",
        "lastError": None,
        "lastSeenAt": None,
    }
    return upsert_account(account)


def update_account(account_id: str, **fields) -> dict | None:
    current = get_account(account_id)
    if not current:
        return None
    fields["updatedAt"] = now()
    return upsert_account({**current, **fields})


def delete_account(account_id: str) -> bool:
    accounts = list_accounts()
    rest = [item for item in accounts if str(item.get("id")) != str(account_id)]
    if len(rest) == len(accounts):
        return False
    _save_accounts(rest)
    try:
        os.unlink(session_path(account_id))
    except OSError:
        pass
    return True


def session_path(account_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9]", "", str(account_id))
    return os.path.join(SESSION_DIR, f"{safe}.session")


def write_session(account_id: str, value: str) -> None:
    _write_private(session_path(account_id), value)


def read_session(account_id: str) -> str | None:
    try:
        with open(session_path(account_id), "r", encoding="utf-8") as handle:
            value = handle.read().strip()
    except OSError:
        return None
    return value or None


# ─── فایل آهنگ ───────────────────────────────
def library_root() -> str:
    return os.path.realpath(MUSIC_ROOT)


def to_library_path(raw: str) -> str:
    """
    مسیری که ربات می‌فرستد داخل پوشهٔ خودش است (/app/data/music/…)؛ اینجا همان
    فایل با پوشهٔ فقط‌خواندنی /app/music دیده می‌شود. پس اگر مسیر داخل کتابخانهٔ
    ربات بود، همان نسبیِ داخل کتابخانهٔ ما می‌شود. مسیر نسبی هم از ریشهٔ
    کتابخانه خوانده می‌شود تا بیرون از آن چیزی باز نشود.
    """
    text = str(raw or "").strip().replace("\\", "/")
    marker = "/data/music/"
    index = text.find(marker)
    if index >= 0:
        text = text[index + len(marker):]
    if not text.startswith("/"):
        text = os.path.join(MUSIC_ROOT, text)
    return text


def resolve_audio_path(raw: str) -> str:
    """
    مسیر آهنگ را فقط داخل کتابخانه (/app/music) قبول می‌کند.
    هر مسیر بیرون از آن (مثل /etc/passwd) رد می‌شود.
    """
    if not raw:
        raise ValueError("empty-path")
    candidate = os.path.realpath(to_library_path(raw))
    root = os.path.realpath(MUSIC_ROOT)
    if not candidate.startswith(root + os.sep) and candidate != root:
        raise ValueError("path-outside-library")
    if not os.path.isfile(candidate):
        raise ValueError("file-not-found")
    return candidate


def valid_phone(phone: str) -> bool:
    return bool(PHONE_RE.match(str(phone or "").strip().replace(" ", "-").replace(" ", "")))


def mask_phone(phone: str) -> str:
    text = str(phone or "")
    if len(text) <= 7:
        return "•" * len(text)
    return f"{text[:5]}…{text[-4:]}"
