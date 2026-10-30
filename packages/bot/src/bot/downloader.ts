import { Context } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { getSetting, getSettingBool, getSettingNumber } from '../lib/settings.js';
import { getText } from '../lib/texts.js';
import { mainMenuKeyboard } from '../lib/ui.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);

const DOWNLOAD_DIR = '/tmp/sulduz-downloads';
const COOKIE_FILE = process.env.YTDLP_COOKIES || '/app/data/instagram-cookies.txt';

export async function handleDownloader(ctx: Context, user: any, url: string) {
  const enabled = await getSettingBool('downloader_enabled');
  if (!enabled) {
    await ctx.reply(await getText('downloader.disabled'), await mainMenuKeyboard());
    return;
  }

  const maxDownloads = (await getSettingNumber('max_downloads_per_day')) || 5;
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const todayDownloads = await prisma.download.count({
    where: {
      userId: user.id,
      createdAt: { gte: today },
      status: 'COMPLETED',
    },
  });

  if (todayDownloads >= maxDownloads) {
    await ctx.reply(await getText('downloader.limit', { max: maxDownloads }), await mainMenuKeyboard());
    return;
  }

  const isInstagram = url.includes('instagram.com');
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

  if (!isInstagram && !isYoutube) {
    await ctx.reply(await getText('downloader.unsupported'), await mainMenuKeyboard());
    return;
  }

  if (!/^https:\/\/[^\s"'`<>\\]+$/i.test(url) || url.length > 500) {
    await ctx.reply(await getText('downloader.invalid'), await mainMenuKeyboard());
    return;
  }

  await ctx.reply(await getText('downloader.processing'));

  const download = await prisma.download.create({
    data: {
      userId: user.id,
      type: isInstagram ? 'INSTAGRAM' : 'YOUTUBE',
      url,
      status: 'DOWNLOADING',
    },
  });

  try {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    const outputFile = path.join(DOWNLOAD_DIR, `${download.id}_%(title).80s.%(ext)s`);
    const maxSizeMb = (await getSettingNumber('max_download_size_mb')) || 50;
    const maxSizeBytes = maxSizeMb * 1024 * 1024;

    const args: string[] = ['--no-playlist', '--max-filesize', String(maxSizeBytes), '-o', outputFile];

    if (isInstagram) {
      args.push('--no-check-certificates');
      if (fs.existsSync(COOKIE_FILE)) {
        args.push('--cookies', COOKIE_FILE);
      }
    } else {
      args.push('-f', 'bestvideo*[height<=720]+bestaudio/best[height<=720]/bestvideo*+bestaudio/best');
    }

    const proxy = await resolveProxy();
    if (proxy) {
      args.push('--proxy', proxy);
    }

    args.push(url);

    await execFileAsync('yt-dlp', args, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });

    const files = fs
      .readdirSync(DOWNLOAD_DIR)
      .filter((f) => f.startsWith(`${download.id}_`))
      .filter((f) => !f.endsWith('.part') && !f.endsWith('.ytdl'));

    if (files.length === 0) {
      throw new Error('EMPTY');
    }

    const filePath = path.join(DOWNLOAD_DIR, files[0]);
    const stats = fs.statSync(filePath);

    if (stats.size > maxSizeBytes) {
      fs.unlinkSync(filePath);
      throw new Error(`TOO_BIG:${maxSizeMb}`);
    }

    await prisma.download.update({
      where: { id: download.id },
      data: {
        status: 'COMPLETED',
        filePath,
        fileSize: stats.size,
      },
    });

    const botUsername = (ctx.botInfo?.username || '').replace(/^@/, '');
    const caption =
      (await getText('downloader.caption', { size: (stats.size / 1024 / 1024).toFixed(1) })) +
      (botUsername ? `\n🤖 @${botUsername}` : '');

    await ctx.replyWithDocument({ source: filePath }, { caption, ...(await mainMenuKeyboard()) });

    setTimeout(() => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }, 3600000);
  } catch (error: any) {
    console.error('Download error:', error);

    await prisma.download.update({
      where: { id: download.id },
      data: {
        status: 'FAILED',
        error: String(error.stderr || error.message || error).slice(0, 4000),
      },
    });

    await ctx.reply(
      await getText('downloader.error', { error: await friendlyError(error) }),
      await mainMenuKeyboard()
    );
  }
}

async function resolveProxy(): Promise<string | undefined> {
  const customEnabled = await getSettingBool('ytdlp_proxy_enabled');
  const customProxy = ((await getSetting('ytdlp_proxy_url')) || '').trim();

  if (customEnabled && customProxy) {
    return customProxy;
  }

  return process.env.YTDLP_PROXY || undefined;
}

async function friendlyError(error: any): Promise<string> {
  const msg = String(error.stderr || error.message || error);

  const tooBig = msg.match(/^TOO_BIG:(\d+)/);
  if (tooBig) return getText('downloader.too_big', { mb: tooBig[1] });
  if (/^EMPTY/.test(msg)) return getText('downloader.empty');

  if (/Sign in to confirm|not a bot|confirm you/i.test(msg)) return getText('downloader.bot_check');
  if (/rate-limit|login required|redirected to the login page|checkpoint/i.test(msg)) {
    return getText('downloader.login');
  }
  if (/Private video|age-restricted|members-only/i.test(msg)) return getText('downloader.private_video');
  if (/not available|empty media response/i.test(msg)) return getText('downloader.private');
  if (/Unsupported URL|is not a valid URL/i.test(msg)) return getText('downloader.unsupported_url');
  if (/max-filesize|larger than/i.test(msg)) return getText('downloader.max_size');
  if (error.killed) return getText('downloader.timeout');

  return getText('downloader.unknown');
}
