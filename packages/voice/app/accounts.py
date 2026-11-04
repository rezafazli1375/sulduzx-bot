# -*- coding: utf-8 -*-
"""
حساب‌های تلگرام (MTProto) با Telethon.

· هر حساب یک TelegramClient با StringSession است. رشتهٔ سشن فقط در
  data/voice/sessions (فایل ۰۶۰۰) می‌نشیند؛ نه در دیتابیس و نه در مخزن.
· ورود سه‌مرحله‌ای است: start (کد ارسال می‌شود) → confirm (کد؛ و اگر حساب
  رمز دو مرحله‌ای داشته باشد، رمز) → حساب آماده.
· شماره، کد و رمز فقط در حافظهٔ موقت و حداکثر ۱۵ دقیقه می‌مانند و بلافاصله
  پس از ورود یا لغو دور ریخته می‌شوند.
"""
import asyncio
import uuid

from telethon import TelegramClient
from telethon.errors import RPCError
from telethon.sessions import StringSession

from . import store

PENDING_TTL_SECONDS = 15 * 60

# متن فارسی خطاها؛ کلید نام کلاس خطای Telethon است تا با تغییر نسخه نشکنیم
ERROR_TEXT = {
    "PhoneNumberInvalidError": "شمارهٔ موبایل معتبر نیست. آن را با کد کشور وارد کنید، مثلاً ‎+989121234567",
    "PhoneNumberBannedError": "این شماره توسط تلگرام مسدود شده و نمی‌تواند وارد شود.",
    "SessionPasswordNeededError": "این حساب رمز دو مرحله‌ای دارد. رمز را وارد کنید.",
    "PasswordHashInvalidError": "رمز دو مرحله‌ای درست نیست.",
    "PasswordInvalidError": "رمز دو مرحله‌ای درست نیست.",
    "PhoneCodeInvalidError": "کد وارد شده درست نیست.",
    "PhoneCodeExpiredError": "کد منقضی شده است. دوباره درخواست کد بدهید.",
    "PhoneCodeConfirmNeededError": "تلگرام تأیید اضافه می‌خواهد. در اپ تلگرام بررسی کنید.",
    "SessionExpiredError": "مهلک ورود تمام شد. دوباره درخواست کد بدهید.",
    "AuthKeyUnregisteredError": "نشست این حساب در تلگرام باطل شده است. لازم است دوباره وارد شوید.",
    "AuthKeyInvalidError": "نشست این حساب باطل شده است. لازم است دوباره وارد شوید.",
    "SessionRevokedError": "نشست حساب لغو شده است. دوباره وارد شوید.",
    "ApiIdInvalidError": "API_ID یا API_HASH درست نیست.",
    "ApiIdPublishedFloodError": "این API_ID عمومی/افشا شده است و تلگرام اجازهٔ ورود نمی‌دهد؛ از my.telegram.org یک API_ID تازه بسازید.",
    "FloodError": "درخواست‌های ورود بیش از حد مجاز شد. کمی بعد دوباره تلاش کنید.",
    "FloodWaitError": "درخواست‌های ورود بیش از حد مجاز شد. کمی بعد دوباره تلاش کنید.",
    "SMSCodeRequestLimitReached": "سقف ارسال کد پر شده است. چند دقیقه صبر کنید.",
    "CodeAuthorizerNotFound": "کدی برای تأیید وجود ندارد. دوباره درخواست کد بدهید.",
    "InvalidBufferError": "ارتباط با تلگرام قطع شد. دوباره درخواست کد بدهید.",
    "TimedOutError": "ارتباط با تلگرام قطع شد. دوباره تلاش کنید.",
    "ConnectionError": "این سرور نمی‌تواند به تلگرام وصل شود (سرور باید به تلگرام دسترسی داشته باشد).",
}


class VoiceError(Exception):
    """خطای خوانا برای پنل و ربات: کد + پیام فارسی + کد وضعیت HTTP."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def friendly(exc: Exception, fallback: str = "اتصال به تلگرام ناموفق بود.") -> str:
    name = type(exc).__name__
    for key, text in ERROR_TEXT.items():
        if key == name or key in name:
            return text
    if isinstance(exc, RPCError):
        return f"تلگرام خطا داد: {name}"
    return fallback


def require_keys() -> tuple:
    cfg = store.load_config()
    api_id = cfg.get("apiId")
    api_hash = cfg.get("apiHash")
    if not api_id or not api_hash:
        raise VoiceError(
            "api-keys-missing",
            "ابتدا API_ID و API_HASH را وارد کنید (از my.telegram.org).",
            status=409,
        )
    return int(api_id), str(api_hash)


def new_client(session) -> TelegramClient:
    api_id, api_hash = require_keys()
    # receive_updates=False: این حساب فقط برای عضویت و پخش در ویس‌کال است و
    # گره‌خوردن به صندوق پیام‌های خصوصی لازم نیست؛ منابع سرور هم کمتر مصرف می‌شود.
    return TelegramClient(
        session,
        api_id,
        api_hash,
        receive_updates=False,
        request_retries=3,
        connection_retries=3,
        auto_reconnect=True,
        device_model="Sulduz Music",
        system_version="1.0",
        app_version="Sulduz Bot",
        lang_code="fa",
    )


def normalize_phone(phone: str) -> str:
    return str(phone or "").strip().replace(" ", "").replace("­", "")


# ─── مشتری‌های متصل ──────────────────────────
_clients: dict = {}
_locks: dict = {}
_pending: dict = {}


def _lock_for(account_id: str) -> asyncio.Lock:
    lock = _locks.get(account_id)
    if lock is None:
        lock = asyncio.Lock()
        _locks[account_id] = lock
    return lock


def connected_ids() -> list:
    out = []
    for account_id, client in _clients.items():
        try:
            if client.is_connected():
                out.append(account_id)
        except Exception:
            pass
    return out


async def _safe_disconnect(client) -> None:
    if client is None:
        return
    try:
        await client.disconnect()
    except Exception:
        pass


async def _drop_client(account_id: str) -> None:
    client = _clients.pop(account_id, None)
    await _safe_disconnect(client)


def _invalid_session(account_id: str) -> VoiceError:
    store.update_account(account_id, status="needs-login", lastError="نشست نامعتبر")
    return VoiceError(
        "session-invalid",
        "نشست این حساب در تلگرام دیگر معتبر نیست؛ باید دوباره با کد وارد آن شوید.",
        status=409,
    )


def _client_from_session(account_id: str, session_value: str) -> TelegramClient:
    """
    TelegramClient از رشتهٔ سشن ذخیره‌شده.
    رشتهٔ خراب یا بی‌کلید، «خطای غیرمنتظره» نمی‌دهد؛ پیام خوانا می‌دهد که لازم
    است دوباره وارد حساب شد.
    """
    require_keys()
    try:
        session = StringSession(session_value)
    except Exception:
        raise _invalid_session(account_id)
    try:
        return new_client(session)
    except VoiceError:
        raise
    except Exception:
        raise _invalid_session(account_id)


async def get_client(account_id: str) -> TelegramClient:
    """مشتریِ متصلِ همان حساب؛ در صورت لزوم از سشن ذخیره‌شده می‌سازد و وصل می‌شود."""
    account = store.get_account(account_id)
    if not account:
        raise VoiceError("account-not-found", "حسابی با این شناسه ثبت نشده است.", status=404)

    client = _clients.get(account_id)
    if client is not None:
        try:
            if not client.is_connected():
                await client.connect()
            if await client.is_user_authorized():
                return client
        except VoiceError:
            raise
        except Exception as exc:
            raise VoiceError("connect-failed", friendly(exc, "وصل‌شدن به تلگرام ناموفق بود."), status=502)
        await _drop_client(account_id)
        raise _invalid_session(account_id)

    session_value = store.read_session(account_id)
    if not session_value:
        raise VoiceError(
            "not-logged-in",
            "این حساب هنوز وارد نشده است؛ از پنل شماره و کد را تأیید کنید.",
            status=409,
        )

    async with _lock_for(account_id):
        # ممکن است هم‌زمان ورودی دیگری همین حساب را وصل کرده باشد
        client = _clients.get(account_id)
        if client is not None:
            try:
                if not client.is_connected():
                    await client.connect()
                if await client.is_user_authorized():
                    return client
            except Exception as exc:
                raise VoiceError("connect-failed", friendly(exc, "وصل‌شدن به تلگرام ناموفق بود."), status=502)
            await _drop_client(account_id)
            raise _invalid_session(account_id)

        client = _client_from_session(account_id, session_value)
        try:
            await client.connect()
            authorized = await client.is_user_authorized()
        except VoiceError:
            await _safe_disconnect(client)
            raise
        except Exception as exc:
            await _safe_disconnect(client)
            raise VoiceError("connect-failed", friendly(exc, "وصل‌شدن به تلگرام ناموفق بود."), status=502)
        if not authorized:
            await _safe_disconnect(client)
            raise _invalid_session(account_id)
        _clients[account_id] = client
        store.update_account(account_id, status="ready", lastError=None, lastSeenAt=store.now())
        return client


async def refresh_account(account_id: str) -> dict:
    """مشخصات حساب (نام، نام کاربری، دی‌سی) را از تلگرام می‌خواند و ذخیره می‌کند."""
    account = store.get_account(account_id) or {}
    client = _clients.get(account_id)
    if client is None:
        return account
    try:
        me = await client.get_me()
    except Exception as exc:
        return store.update_account(account_id, status="error", lastError=friendly(exc)) or account
    if me is None:
        return account
    init_response = getattr(client, "_init_response", None)
    dc_id = getattr(init_response, "dc_id", None) or getattr(client.session, "dc_id", None)
    return store.update_account(
        account_id,
        userId=getattr(me, "id", None),
        firstName=getattr(me, "first_name", None),
        lastName=getattr(me, "last_name", None),
        username=getattr(me, "username", None),
        phone=getattr(me, "phone", None) or account.get("phone"),
        dcId=dc_id,
        premium=bool(getattr(me, "premium", False)),
        status="ready",
        lastError=None,
        lastSeenAt=store.now(),
    ) or account


async def logout_account(account_id: str) -> None:
    """خروج: از تلگرام می‌خواهیم سشن را باطل کند، سپس فایل‌های محلی پاک می‌شوند."""
    client = _clients.get(account_id)
    temporary = None
    if client is None:
        session_value = store.read_session(account_id)
        if not session_value:
            store.delete_account(account_id)
            return
        try:
            temporary = _client_from_session(account_id, session_value)
            await temporary.connect()
            client = temporary
        except Exception as exc:
            await _safe_disconnect(temporary)
            raise VoiceError("logout-failed", friendly(exc, "خروج از حساب ناموفق بود."), status=502)
    try:
        await client.log_out()
    except Exception as exc:
        raise VoiceError("logout-failed", friendly(exc, "خروج از حساب ناموفق بود."), status=502)
    finally:
        await _safe_disconnect(temporary)
        await _drop_client(account_id)
    store.delete_account(account_id)


async def forget_account(account_id: str) -> None:
    """فقط سشن محلی را پاک می‌کند (بدون اطلاع به تلگرام)."""
    await _drop_client(account_id)
    store.delete_account(account_id)


async def shutdown() -> None:
    for entry in list(_pending.values()):
        await _safe_disconnect(entry.get("client"))
    _pending.clear()
    for account_id in list(_clients):
        await _drop_client(account_id)


# ─── ورود سه مرحله‌ای ────────────────────────
def _sweep_pending() -> None:
    deadline = store.now() - PENDING_TTL_SECONDS
    for token in [t for t, e in _pending.items() if float(e.get("createdAt", 0)) < deadline]:
        entry = _pending.pop(token, None)
        if entry:
            _fire_disconnect(entry.get("client"))


def _fire_disconnect(client) -> None:
    try:
        asyncio.ensure_future(_safe_disconnect(client))
    except Exception:
        pass


def _account_for_phone(phone: str) -> dict:
    """حسابِ همان شماره (برای اینکه ورود دوباره حساب تکراری نسازد)."""
    for item in store.list_accounts():
        if str(item.get("phone") or "") == str(phone):
            return item
    return None


async def start_login(phone: str, label: str = "") -> dict:
    """کد ورود را می‌فرستد و توکن موقت برمی‌گرداند."""
    normalized = normalize_phone(phone)
    if not store.valid_phone(normalized):
        raise VoiceError("bad-phone", "شمارهٔ موبایل معتبر نیست (مثال: ‎+989121234567).")
    api_id, api_hash = require_keys()
    _sweep_pending()

    client = TelegramClient(StringSession(), api_id, api_hash, receive_updates=False)
    token = uuid.uuid4().hex[:16]
    try:
        await client.connect()
        sent = await client.send_code_request(normalized)
    except VoiceError:
        await _safe_disconnect(client)
        raise
    except Exception as exc:
        await _safe_disconnect(client)
        raise VoiceError("code-send-failed", friendly(exc, "ارسال کد ورود ناموفق بود."), status=502)

    code_type = type(getattr(sent, "type", None)).__name__
    _pending[token] = {
        "token": token,
        "phone": normalized,
        "label": (label or "").strip()[:40],
        "client": client,
        "phoneCodeHash": getattr(sent, "phone_code_hash", None),
        "codeType": code_type,
        "createdAt": store.now(),
        "passwordStep": False,
    }
    return {
        "token": token,
        "phone": store.mask_phone(normalized),
        "codeType": code_type,
        # CodeTypeApp یعنی کد در خود اپ تلگرام (نه پیامک) نمایش داده می‌شود
        "sentInsideTelegram": code_type == "CodeTypeApp",
        "needsPassword": False,
        "expiresIn": PENDING_TTL_SECONDS,
    }


def _get_pending(token: str) -> dict:
    _sweep_pending()
    entry = _pending.get(str(token or ""))
    if not entry:
        raise VoiceError(
            "login-expired",
            "مهلک ورود تمام شد یا درخواست کدی باز نیست. دوباره شماره را بزنید.",
            status=410,
        )
    return entry


async def confirm_login(token: str, code: str = None, password: str = None) -> dict:
    """
    مرحلهٔ دوم: کد. اگر حساب رمز دو مرحله‌ای داشته باشد، تلگرام
    SessionPasswordNeededError می‌دهد؛ همان توکن برای مرحلهٔ رمز باز می‌ماند.
    """
    entry = _get_pending(token)
    client = entry["client"]
    phone = entry["phone"]

    if entry.get("passwordStep"):
        if not password:
            raise VoiceError("password-required", "رمز دو مرحله‌ای این حساب را وارد کنید.", status=409)
        try:
            await client.sign_in(password=str(password))
        except Exception as exc:
            name = type(exc).__name__
            if "Password" in name or "TwoStep" in name:
                raise VoiceError("password-rejected", "رمز دو مرحله‌ای درست نیست.", status=401)
            raise VoiceError("sign-in-failed", friendly(exc, "ورود به حساب ناموفق بود."), status=502)
    else:
        if not code:
            raise VoiceError("code-required", "کد ورود را وارد کنید.")
        try:
            await client.sign_in(
                phone=phone,
                code=str(code).strip(),
                phone_code_hash=entry.get("phoneCodeHash"),
            )
        except Exception as exc:
            name = type(exc).__name__
            if "SessionPasswordNeeded" in name:
                entry["passwordStep"] = True
                entry["createdAt"] = store.now()
                return {"needsPassword": True, "token": entry["token"], "account": None}
            raise VoiceError("code-rejected", friendly(exc, "کد ورود پذیرفته نشد."), status=401)

    # ورود موفق: سشن روی دیسک، حساب ثبت یا به‌روز، و همان اتصال نگه داشته می‌شود
    account = _account_for_phone(phone)
    if account is None:
        account = store.create_account(phone, entry.get("label") or "")
    account_id = account["id"]

    try:
        me = await client.get_me()
        session_value = client.session.save()
    except Exception as exc:
        await _safe_disconnect(client)
        raise VoiceError("profile-failed", friendly(exc, "خواندن مشخصات حساب ناموفق بود."), status=502)
    if hasattr(session_value, "decode"):
        session_value = session_value.decode()
    if not session_value:
        await _safe_disconnect(client)
        raise VoiceError("session-empty", "سشن این حساب ساخته نشد. دوباره تلاش کنید.", status=502)
    store.write_session(account_id, str(session_value))

    init_response = getattr(client, "_init_response", None)
    dc_id = getattr(init_response, "dc_id", None) or getattr(client.session, "dc_id", None)
    saved = store.update_account(
        account_id,
        phone=getattr(me, "phone", None) or phone,
        label=entry.get("label") or account.get("label") or "",
        userId=getattr(me, "id", None),
        firstName=getattr(me, "first_name", None),
        lastName=getattr(me, "last_name", None),
        username=getattr(me, "username", None),
        dcId=dc_id,
        premium=bool(getattr(me, "premium", False)),
        status="ready",
        lastError=None,
        lastSeenAt=store.now(),
    )

    previous = _clients.get(account_id)
    if previous is not None and previous is not client:
        await _safe_disconnect(previous)
    _clients[account_id] = client
    _pending.pop(entry["token"], None)
    return {"needsPassword": False, "token": None, "account": public_account(saved)}


async def cancel_login(token: str) -> dict:
    entry = _pending.pop(str(token or ""), None)
    if entry:
        await _safe_disconnect(entry.get("client"))
    return {"cancelled": True}


def public_account(account: dict) -> dict:
    """چیزی که پنل می‌بیند: بدون سشن، با شمارهٔ ماسک‌شده."""
    if not account:
        return None
    account_id = str(account.get("id") or "")
    return {
        "id": account.get("id"),
        "phone": store.mask_phone(account.get("phone") or ""),
        "label": account.get("label") or "",
        "firstName": account.get("firstName"),
        "lastName": account.get("lastName"),
        "username": account.get("username"),
        "dcId": account.get("dcId"),
        "premium": bool(account.get("premium")),
        "status": account.get("status"),
        "lastError": account.get("lastError"),
        "lastSeenAt": account.get("lastSeenAt"),
        "createdAt": account.get("createdAt"),
        "hasSession": bool(store.read_session(account_id)),
        "connected": account_id in connected_ids(),
    }
