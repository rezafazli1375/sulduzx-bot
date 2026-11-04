# -*- coding: utf-8 -*-
"""
پخش آهنگ در ویس‌کال گروه‌ها با py-tgcalls (روی هستهٔ ntgcalls).

· هر حساب تلگرام یک PyTgCalls دارد که روی همان TelegramClient سوار می‌شود.
· وضعیت پخش به ازای هر گروه (chat_id) نگه داشته می‌شود؛ ربات همین وضعیت را
  می‌خواند تا بداند آهنگ تمام شده و آهنگ بعدی را بفرستد.
· رویداد StreamEnded از py-tgcalls پایان استریم را خبر می‌دهد؛ اگر رویداد هم
  نیاید (قطع‌شدن اتصال)، مدت‌زمانی که ربات می‌فرستد به‌عنوان مهلت پشتیبان
  استفاده می‌شود تا رکورد «در حال پخش» معلق نماند.
· سقف پخش هم‌زمان روی سرور اعمال می‌شود تا CPU/پهنای باند سرور اشباع نشود.
"""
import asyncio

from pytgcalls import PyTgCalls
from pytgcalls import exceptions as tgce
from pytgcalls.types import AudioQuality, GroupCallConfig, MediaStream, StreamEnded

from . import accounts, store

AUDIO_QUALITY = {
    "low": AudioQuality.LOW,
    "medium": AudioQuality.MEDIUM,
    "high": AudioQuality.HIGH,
    "studio": AudioQuality.STUDIO,
}

# متن فارسی خطاهای py-tgcalls
TG_ERROR_TEXT = {
    "NoActiveGroupCall": "ویس‌کال این گروه باز نشده است. برای پخش در ویس‌کال، یکی از اعضا باید ویس‌کال گروه را باز کند.",
    "CallBusy": "ویس‌کال این گروه شلوغ است؛ چند لحظه بعد دوباره تلاش کنید.",
    "NotInCallError": "حساب تلگرام در ویس‌کال این گروه حضور ندارد.",
    "NoMTProtoClientSet": "حساب تلگرام به سرویس ویس وصل نیست.",
    "MTProtoClientNotConnected": "حساب تلگرام قطع شده است؛ دوباره وصل می‌شود، چند لحظه بعد تلاش کنید.",
    "InvalidMTProtoClient": "حساب تلگرام معتبر نیست؛ باید دوباره در آن ورود انجام شود.",
    "ClientNotStarted": "سرویس ویس برای این حساب آماده نشده است.",
    "NoAudioSourceFound": "این فایل آهنگ قابل پخش نیست (صدای معتبر در آن پیدا نشد).",
    "FFmpegError": "پردازش فایل آهنگ با خطا روبه‌رو شد.",
    "FileError": "فایل آهنگ خوانده نشد.",
    "InvalidPhoneMucRequired": "این گروه برای ویس‌کال محدودیت دارد.",
    "ChatNotFound": "گروه در تلگرام پیدا نشد؛ حساب باید عضو گروه باشد.",
    "TimedOutAnswer": "پاسخی از تلگرام نیامد؛ چند لحظه بعد دوباره تلاش کنید.",
    "CallFailed": "اتصال به ویس‌کال برقرار نشد.",
    "TooOldTelethonVersion": "نسخهٔ کتابخانهٔ تلگرام سرویس قدیمی است.",
}

MAX_VOLUME = 200

_lock = asyncio.Lock()
_calls: dict = {}
_streams: dict = {}


def tg_message(exc: Exception, fallback: str = "پخش در ویس‌کال ناموفق بود.") -> str:
    name = type(exc).__name__
    for key, text in TG_ERROR_TEXT.items():
        if key in name:
            return text
    return f"{fallback} ({name})"


async def engine_for(account_id: str) -> PyTgCalls:
    """PyTgCalls همان حساب؛ اگر نیست ساخته و start می‌شود."""
    async with _lock:
        client = await accounts.get_client(account_id)
        engine = _calls.get(account_id)
        if engine is not None:
            return engine
        engine = PyTgCalls(client, workers=2, cache_duration=600)
        _install_handler(engine, account_id)
        try:
            await engine.start()
        except tgce.PyTgCallsAlreadyRunning:
            pass
        except Exception as exc:
            raise accounts.VoiceError(
                "engine-start-failed",
                accounts.friendly(exc, "راه‌اندازی موتور صوتی ناموفق بود."),
                status=502,
            )
        _calls[account_id] = engine
        return engine


def _install_handler(engine: PyTgCalls, account_id: str) -> None:
    def on_update(_client, update) -> None:
        if isinstance(update, StreamEnded):
            mark_finished(str(update.chat_id), "stream-ended")

    try:
        engine.add_handler(on_update, [StreamEnded])
    except Exception:
        # اگر امضای add_handler در نسخه‌ای فرق کرد، ربات با poll هم متوجه پایان می‌شود
        pass


def chat_engine(account_id: str):
    return _calls.get(account_id)


def active_count() -> int:
    return len([state for state in _streams.values() if state.get("status") == "playing"])


async def play(
    chat_id,
    audio_path: str,
    account_id: str = None,
    title: str = "",
    duration: int = 0,
    quality: str = "high",
    volume: int = 100,
    auto_start: bool = True,
    max_streams: int = 0,
    loop: bool = False,
) -> dict:
    """پخش (یا جایگزینی) آهنگ در ویس‌کال گروه."""
    if not account_id:
        raise accounts.VoiceError("no-account", "حساب ویس‌کالی انتخاب نشده است.", status=409)
    try:
        path = store.resolve_audio_path(audio_path)
    except ValueError as exc:
        code = str(exc)
        text = {
            "path-outside-library": "مسیر آهنگ خارج از کتابخانهٔ موزیک است.",
            "file-not-found": "فایل این آهنگ روی سرور نیست. برای پخش در ویس‌کال باید دانلود شود.",
            "empty-path": "مسیر آهنگ ارسال نشده است.",
        }.get(code, "فایل آهنگ معتبر نیست.")
        raise accounts.VoiceError(code or "bad-path", text, status=404 if code == "file-not-found" else 400)

    numeric_chat = parse_chat_id(chat_id)
    engine = await engine_for(account_id)

    if max_streams and max_streams > 0 and active_count() >= max_streams:
        existing = _streams.get(str(numeric_chat))
        if not existing:
            raise accounts.VoiceError(
                "max-streams",
                f"سقف پخش هم‌زمان این سرور ({max_streams}) پر است.",
                status=429,
            )

    stream = MediaStream(path, audio_parameters=quality_for(quality))
    config = GroupCallConfig(invite_hash=None, join_as=None, auto_start=bool(auto_start))
    try:
        await engine.play(numeric_chat, stream, config)
    except Exception as exc:
        raise accounts.VoiceError("play-failed", tg_message(exc), status=502)

    volume = clamp_volume(volume)
    try:
        await engine.change_volume_call(numeric_chat, volume)
    except Exception:
        pass

    state = {
        "chatId": numeric_chat,
        "accountId": account_id,
        "title": (title or "")[:120],
        "path": path,
        "status": "playing",
        "volume": volume,
        "quality": quality,
        "loop": bool(loop),
        "duration": max(0, int(duration or 0)),
        "startedAt": store.now(),
        "endedAt": None,
        "endReason": None,
    }
    _streams[str(numeric_chat)] = state
    return dict(state)


async def stop(chat_id, close: bool = False) -> dict:
    numeric_chat = parse_chat_id(chat_id)
    key = str(numeric_chat)
    state = _streams.get(key)
    engine = _calls.get((state or {}).get("accountId"))
    if engine is None:
        engine = next((item for item in _calls.values()), None)
    if engine is not None:
        try:
            await engine.leave_call(numeric_chat, close=bool(close))
        except tgce.NotInCallError:
            pass
        except Exception as exc:
            raise accounts.VoiceError("stop-failed", tg_message(exc, "توقف پخش ناموفق بود."), status=502)
    if state:
        state["status"] = "stopped"
        state["endedAt"] = store.now()
        state["endReason"] = "stopped"
        # رکورد را نگه نمی‌داریم: از این پس /status برای این گروه «idle» می‌گوید
        _streams.pop(key, None)
    return {"chatId": numeric_chat, "stopped": True}


async def pause(chat_id) -> dict:
    numeric_chat = parse_chat_id(chat_id)
    state = _streams.get(str(numeric_chat))
    engine = _calls.get((state or {}).get("accountId")) if state else None
    if engine is None:
        raise accounts.VoiceError("not-playing", "در این گروه چیزی در حال پخش نیست.", status=409)
    try:
        paused = await engine.pause(numeric_chat)
    except Exception as exc:
        raise accounts.VoiceError("pause-failed", tg_message(exc, "توقف موقت ناموفق بود."), status=502)
    if state:
        state["status"] = "paused"
    return {"chatId": numeric_chat, "paused": bool(paused)}


async def resume(chat_id) -> dict:
    numeric_chat = parse_chat_id(chat_id)
    state = _streams.get(str(numeric_chat))
    engine = _calls.get((state or {}).get("accountId")) if state else None
    if engine is None:
        raise accounts.VoiceError("not-playing", "در این گروه چیزی در حال پخش نیست.", status=409)
    try:
        ok = await engine.resume(numeric_chat)
    except Exception as exc:
        raise accounts.VoiceError("resume-failed", tg_message(exc, "ادامهٔ پخش ناموفق بود."), status=502)
    if state:
        state["status"] = "playing"
    return {"chatId": numeric_chat, "resumed": bool(ok)}


async def set_volume(chat_id, volume: int) -> dict:
    numeric_chat = parse_chat_id(chat_id)
    state = _streams.get(str(numeric_chat))
    engine = _calls.get((state or {}).get("accountId")) if state else None
    if engine is None:
        raise accounts.VoiceError("not-playing", "در این گروه چیزی در حال پخش نیست.", status=409)
    value = clamp_volume(volume)
    try:
        await engine.change_volume_call(numeric_chat, value)
    except Exception as exc:
        raise accounts.VoiceError("volume-failed", tg_message(exc, "تغییر صدا ناموفق بود."), status=502)
    if state:
        state["volume"] = value
    return {"chatId": numeric_chat, "volume": value}


async def mute(chat_id, silenced: bool = False) -> dict:
    numeric_chat = parse_chat_id(chat_id)
    state = _streams.get(str(numeric_chat))
    engine = _calls.get((state or {}).get("accountId")) if state else None
    if engine is None:
        raise accounts.VoiceError("not-playing", "در این گروه چیزی در حال پخش نیست.", status=409)
    try:
        await (engine.mute(numeric_chat) if silenced else engine.unmute(numeric_chat))
    except Exception as exc:
        raise accounts.VoiceError("mute-failed", tg_message(exc, "بی‌صدا کردن ناموفق بود."), status=502)
    return {"chatId": numeric_chat, "muted": bool(silenced)}


def status_for(chat_id=None) -> dict:
    """وضعیت پخش؛ با پایان‌یافتن استریم (یا مهلت پشتیبان) وضعیت idle می‌شود."""
    sweep_expired()
    if chat_id is None or str(chat_id) == "":
        return {
            "activeStreams": active_count(),
            "streams": [dict(state) for state in _streams.values() if state.get("status") in ("playing", "paused")],
        }
    state = _streams.get(str(parse_chat_id(chat_id)))
    if not state:
        return {"chatId": parse_chat_id(chat_id), "status": "idle", "stream": None}
    return {"chatId": state["chatId"], "status": state["status"], "stream": dict(state)}


def mark_finished(chat_id: str, reason: str) -> None:
    state = _streams.get(str(chat_id))
    if not state or state.get("status") != "playing":
        return
    if state.get("loop"):
        return
    state["status"] = "ended"
    state["endedAt"] = store.now()
    state["endReason"] = reason


def sweep_expired() -> list:
    """
    نگهبان: اگر بدون رویداد StreamEnded مدتی از (مدت آهنگ + پنجرهٔ اطمینان)
    گذشت، پخش تمام‌شده حساب می‌شود تا رکورد «در حال پخش» معلق نماند.
    """
    finished = []
    current = store.now()
    for key, state in list(_streams.items()):
        if state.get("status") != "playing" or state.get("loop"):
            continue
        duration = int(state.get("duration") or 0)
        if duration <= 0:
            continue
        window = duration + max(90, int(duration * 0.35))
        if current - float(state.get("startedAt") or 0) > window:
            state["status"] = "ended"
            state["endedAt"] = current
            state["endReason"] = "duration-elapsed"
            finished.append(key)
    return finished


def quality_for(value: str):
    return AUDIO_QUALITY.get(str(value or "high").lower(), AudioQuality.HIGH)


def clamp_volume(value) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 100
    return max(1, min(MAX_VOLUME, number))


def parse_chat_id(value) -> int:
    """
    شناسهٔ گروه را به شکل تلگرامی می‌سازد.
    ربات مقدارBigInt دیتابیس را می‌فرستد: کانال/گروه -100xxx یا همان xxx مثبت.
    """
    text = str(value or "").strip()
    negative = text.startswith("-")
    digits = text[1:] if negative else text
    if negative and digits.startswith("100"):
        digits = digits[3:]
    try:
        number = int(digits)
    except ValueError:
        raise accounts.VoiceError("bad-chat-id", "شناسهٔ گروه معتبر نیست.")
    return -number if negative else number


def known_chats() -> list:
    sweep_expired()
    return [
        {
            "chatId": state["chatId"],
            "accountId": state.get("accountId"),
            "title": state.get("title"),
            "status": state.get("status"),
            "volume": state.get("volume"),
            "startedAt": state.get("startedAt"),
            "endedAt": state.get("endedAt"),
        }
        for state in _streams.values()
    ]


async def shutdown_account(account_id: str) -> None:
    """همهٔ پخش‌های آن حساب بسته و موتور صوتی‌اش حذف می‌شود (برای خروج/حذف حساب)."""
    engine = _calls.pop(account_id, None)
    for key, state in list(_streams.items()):
        if state.get("accountId") != account_id:
            continue
        _streams.pop(key, None)
        if engine is None:
            continue
        try:
            await engine.leave_call(int(state["chatId"]), close=False)
        except Exception:
            pass


async def shutdown() -> None:
    for account_id, engine in list(_calls.items()):
        try:
            for chat_id in list(_streams):
                state = _streams.get(chat_id)
                if state and state.get("accountId") == account_id:
                    try:
                        await engine.leave_call(int(chat_id), close=False)
                    except Exception:
                        pass
        except Exception:
            pass
    _calls.clear()
    _streams.clear()
