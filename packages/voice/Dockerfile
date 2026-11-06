FROM python:3.12-slim-bookworm

# ffmpeg لازم است: py-tgcalls استریم صوتی را با همین باینری می‌سازد و در تصویر
# slim وجود ندارد. (تست شده روی dl23 — بدون آن پخش با FFmpegError می‌شکند.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    VOICE_HOME=/app/voice \
    MUSIC_DIR=/app/music \
    VOICE_PORT=8077

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app

# پورت فقط داخل شبکهٔ داکر است؛ روی سرور منتشر نمی‌شود
EXPOSE 8077

HEALTHCHECK --interval=30s --timeout=6s --start-period=25s --retries=3 \
    CMD python -c "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8077/health', timeout=5); sys.exit(0 if r.status==200 else 1)"

CMD ["python", "-m", "app.server"]
