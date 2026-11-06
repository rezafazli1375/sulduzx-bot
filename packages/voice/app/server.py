# -*- coding: utf-8 -*-
"""
sulduz-voice · سرویس کمکی پخش آهنگ در ویس‌کال تلگرام

این سرویس از بیرون قابل دسترسی نیست (پورتی روی سرور منتشر نمی‌شود)؛ فقط ربات
روی شبکهٔ داخلی داکر آن را صدا می‌زند. کارش سه چیز است:
  ۱) نگه‌داشتن کلید API و حساب‌های تلگرام (فایل‌های ۰۶۰۰ زیر data/voice)
  ۲) ورود سه‌مرحله‌ای حساب از پنل (شماره → کد → رمز دو مرحله‌ای)
  ۳) پخش/توقف آهنگ در ویس‌کال گروه‌ها با py-tgcalls

ربط خودکار آهنگ‌ها («رادیوی گروه») در دست ربات است: ربات هر چند ثانیه /status
را می‌پرسد و وقتی «ended» شد آهنگ بعدی را به /play می‌دهد. این سرویس فقط یک
استریم را در یک گروه پخش یا متوقف می‌کند.

پاسخ‌ها همیشه JSON است و خطاها پیام فارسی خوانا دارند تا ربات همان را در گروه
یا پنل نشان دهد.
"""
import asyncio
import logging
import os
import shutil

from aiohttp import web

from . import accounts, store, streams

log = logging.getLogger("sulduz-voice")

PORT = int(os.environ.get("VOICE_PORT", "8077"))
VERSION = "1.1.0"

DEFAULT_MAX_STREAMS = int(os.environ.get("VOICE_MAX_STREAMS", "5"))
DEFAULT_QUALITY = os.environ.get("VOICE_AUDIO_QUALITY", "high")
DEFAULT_VOLUME = int(os.environ.get("VOICE_VOLUME", "100"))
DEFAULT_AUTO_START = os.environ.get("VOICE_AUTO_START", "1") not in ("0", "false", "no")


def _text(value) -> str:
    return str(value if value is not None else "").strip()


def _int(value, default=0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


async def body(request) -> dict:
    if request.can_read_body:
        try:
            data = await request.json()
        except Exception:
            raise accounts.VoiceError("bad-json", "بدنهٔ درخواست JSON معتبر نیست.")
        if isinstance(data, dict):
            return data
    return {}


# ─── سلامت و تنظیمات ─────────────────────────
async def health(_request):
    return web.json_response(
        {
            "ok": True,
            "service": "sulduz-voice",
            "version": VERSION,
            "mode": "radio",
            "ffmpeg": bool(shutil.which("ffmpeg")),
            "hasApiKeys": store.has_api_keys(),
            "apiIdMasked": store.mask_api_id(),
            "accounts": len(store.list_accounts()),
            "connected": len(accounts.connected_ids()),
            "ready": len(accounts.ready_ids()),
            "activeStreams": streams.active_count(),
            "musicRoot": store.library_root(),
            "musicFiles": count_library_files(),
            "defaults": {
                "maxStreams": DEFAULT_MAX_STREAMS,
                "quality": DEFAULT_QUALITY,
                "volume": DEFAULT_VOLUME,
                "autoStart": DEFAULT_AUTO_START,
            },
        }
    )


def count_library_files() -> int:
    root = store.library_root()
    if not os.path.isdir(root):
        return 0
    total = 0
    for _dirpath, _dirnames, filenames in os.walk(root):
        total += len(filenames)
    return total


async def get_config(_request):
    return web.json_response(
        {
            "configured": store.has_api_keys(),
            "apiIdMasked": store.mask_api_id(),
            "defaults": {
                "maxStreams": DEFAULT_MAX_STREAMS,
                "quality": DEFAULT_QUALITY,
                "volume": DEFAULT_VOLUME,
                "autoStart": DEFAULT_AUTO_START,
            },
        }
    )


async def put_config(request):
    data = await body(request)
    api_id = _text(data.get("apiId") or data.get("api_id")).replace(",", "").replace("_", "")
    api_hash = _text(data.get("apiHash") or data.get("api_hash")).lower()
    if not api_id.isdigit() or not (10 <= len(api_id) <= 12):
        raise accounts.VoiceError("bad-api-id", "API_ID باید فقط رقم باشد (از my.telegram.org).")
    if len(api_hash) != 32 or not all(c in "0123456789abcdef" for c in api_hash):
        raise accounts.VoiceError("bad-api-hash", "API_HASH باید ۳۲ رقم hexadecimal باشد.")
    store.save_config(int(api_id), api_hash)
    return web.json_response({"saved": True, "apiIdMasked": store.mask_api_id()})


async def delete_config(_request):
    store.clear_config()
    await accounts.shutdown()
    await streams.shutdown()
    return web.json_response({"cleared": True})


# ─── ورود حساب ───────────────────────────────
async def login_start(request):
    data = await body(request)
    result = await accounts.start_login(_text(data.get("phone")), _text(data.get("label")))
    return web.json_response(result)


async def login_confirm(request):
    data = await body(request)
    result = await accounts.confirm_login(
        _text(data.get("token")),
        code=_text(data.get("code")) or None,
        password=_text(data.get("password")) or None,
    )
    return web.json_response(result)


async def login_cancel(request):
    data = await body(request)
    return web.json_response(await accounts.cancel_login(_text(data.get("token"))))


async def list_accounts(_request):
    items = []
    for account in store.list_accounts():
        account = await accounts.refresh_account(account.get("id")) or account
        items.append(accounts.public_account(account))
    return web.json_response(
        {"accounts": items, "activeStreams": streams.active_count(), "streams": streams.known_chats()}
    )


async def account_connect(request):
    data = await body(request)
    account_id = _text(data.get("id") or request.match_info.get("id"))
    client = await accounts.get_client(account_id)
    await accounts.refresh_account(account_id)
    account = accounts.public_account(store.get_account(account_id))
    return web.json_response({"connected": client.is_connected(), "account": account})


async def account_logout(request):
    data = await body(request)
    account_id = _text(data.get("id") or request.match_info.get("id"))
    if not store.get_account(account_id):
        raise accounts.VoiceError("account-not-found", "حسابی با این شناسه ثبت نشده است.", status=404)
    await streams.shutdown_account(account_id)
    await accounts.logout_account(account_id)
    return web.json_response({"loggedOut": True})


async def account_forget(request):
    account_id = _text(request.match_info.get("id"))
    if not store.get_account(account_id):
        raise accounts.VoiceError("account-not-found", "حسابی با این شناسه ثبت نشده است.", status=404)
    await streams.shutdown_account(account_id)
    await accounts.forget_account(account_id)
    return web.json_response({"deleted": True})


# ─── پخش ─────────────────────────────────────
def _account_from_request(data: dict) -> str:
    """
    حسابی که پخش با آن انجام می‌شود.

    اگر ربات حساب مشخصی فرستاده باشد و آن حساب آماده نباشد، تکلیف روشن می‌شود
    (پیام «حساب فلان آماده نیست») و سراغ حساب دیگر نمی‌رویم — چون در رادیو
    معمولاً یک شمارهٔ معین برای این کار ثبت شده است.
    """
    ready = accounts.ready_ids()
    chosen = _text(data.get("accountId"))
    if chosen:
        if chosen in ready:
            return chosen
        account = store.get_account(chosen)
        if not account:
            raise accounts.VoiceError(
                "account-not-found",
                "حساب انتخاب‌شده در سرویس ویس‌کال ثبت نشده است. از پنل دوباره حساب را انتخاب کنید.",
                status=404,
            )
        raise accounts.VoiceError(
            "account-not-ready",
            f"حساب {account.get('label') or account.get('phone') or chosen} آمادهٔ پخش نیست "
            f"(وضعیت: {account.get('status') or 'unknown'}). از بخش موزیک پنل وارد آن شوید.",
            status=409,
        )
    if not ready:
        raise accounts.VoiceError(
            "no-account",
            "هنوز حساب تلگرامی برای ویس‌کال وارد نشده است. در پنل، بخش موزیک ← رادیوی ویس‌کال، "
            "کلید API را بگذارید و شمارهٔ مجازی را با کد ورود وارد کنید.",
            status=409,
        )
    return ready[0]


async def play(request):
    data = await body(request)
    result = await streams.play(
        data.get("chatId"),
        _text(data.get("path") or data.get("audioPath")),
        account_id=_account_from_request(data),
        title=_text(data.get("title")),
        duration=_int(data.get("duration"), 0),
        quality=_text(data.get("quality")) or DEFAULT_QUALITY,
        volume=_int(data.get("volume"), DEFAULT_VOLUME),
        auto_start=bool(data.get("autoStart")) if "autoStart" in data else DEFAULT_AUTO_START,
        max_streams=_int(data.get("maxStreams"), DEFAULT_MAX_STREAMS),
        loop=bool(data.get("loop")),
    )
    return web.json_response({"playing": True, "stream": result})


async def stop(request):
    data = await body(request)
    return web.json_response(await streams.stop(data.get("chatId"), close=bool(data.get("close"))))


async def pause(request):
    data = await body(request)
    return web.json_response(await streams.pause(data.get("chatId")))


async def resume(request):
    data = await body(request)
    return web.json_response(await streams.resume(data.get("chatId")))


async def volume(request):
    data = await body(request)
    return web.json_response(await streams.set_volume(data.get("chatId"), data.get("volume")))


async def mute(request):
    data = await body(request)
    return web.json_response(await streams.mute(data.get("chatId"), bool(data.get("muted"))))


async def status(request):
    chat_id = request.query.get("chatId")
    return web.json_response(streams.status_for(chat_id))


async def all_streams(_request):
    return web.json_response({"streams": streams.known_chats(), "activeStreams": streams.active_count()})


# ─── چارچوب HTTP ─────────────────────────────
@web.middleware
async def error_middleware(request, handler):
    try:
        return await handler(request)
    except accounts.VoiceError as exc:
        return web.json_response({"ok": False, "error": exc.message, "code": exc.code}, status=exc.status)
    except web.HTTPException:
        raise
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("voice request failed: %s", request.path)
        return web.json_response(
            {"ok": False, "error": "سرویس ویس‌کال خطای غیرمنتظره داد.", "code": "internal"}, status=500
        )


async def sweeper(app):
    """نگهبان: پخش‌های بی‌صدا را هر ۲۰ ثانیه جمع می‌کند."""
    try:
        while True:
            await asyncio.sleep(20)
            for key in streams.sweep_expired():
                log.info("stream %s treated as finished (duration window)", key)
    except asyncio.CancelledError:
        pass


async def start_sweeper(app):
    app["sweeper"] = asyncio.ensure_future(sweeper(app))


async def stop_sweeper(app):
    app["sweeper"].cancel()


async def cleanup(app):
    await streams.shutdown()
    await accounts.shutdown()


def create_app() -> web.Application:
    store.ensure_dirs()
    app = web.Application(middlewares=[error_middleware], client_max_size=1024 * 1024)
    app.router.add_get("/health", health)
    app.router.add_get("/config", get_config)
    app.router.add_post("/config", put_config)
    app.router.add_delete("/config", delete_config)
    app.router.add_post("/login/start", login_start)
    app.router.add_post("/login/confirm", login_confirm)
    app.router.add_post("/login/cancel", login_cancel)
    app.router.add_get("/accounts", list_accounts)
    app.router.add_post("/accounts/connect", account_connect)
    app.router.add_post("/accounts/logout", account_logout)
    app.router.add_delete("/accounts/{id}", account_forget)
    app.router.add_post("/play", play)
    app.router.add_post("/stop", stop)
    app.router.add_post("/pause", pause)
    app.router.add_post("/resume", resume)
    app.router.add_post("/volume", volume)
    app.router.add_post("/mute", mute)
    app.router.add_get("/status", status)
    app.router.add_get("/streams", all_streams)
    app.on_startup.append(start_sweeper)
    app.on_cleanup.append(stop_sweeper)
    app.on_cleanup.append(cleanup)
    return app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s voice %(message)s")
    store.ensure_dirs()
    if not shutil.which("ffmpeg"):
        log.warning("ffmpeg not found in image — streaming will fail")
    # بنر راه‌اندازی: بدون آن «docker logs sulduz-voice» کاملاً خالی می‌ماند و
    # هنگام عیب‌یابی نمی‌شود فهمید سرویس بالا آمده یا نه (پاسخ health هم که
    # داخل کانتینر است، لاگ بیرونی ندارد).
    log.info(
        "sulduz-voice %s ready on :%d — music=%s api_keys=%s accounts=%d ready=%d",
        VERSION,
        PORT,
        store.MUSIC_ROOT,
        store.has_api_keys(),
        len(store.list_accounts()),
        len(accounts.ready_ids()),
    )
    web.run_app(create_app(), host="0.0.0.0", port=PORT, print=lambda *a: None, access_log=None)


if __name__ == "__main__":
    main()
