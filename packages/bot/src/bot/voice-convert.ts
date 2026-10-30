import { Context } from 'telegraf';
import { getSettingBool, getSettingNumber } from '../lib/settings.js';
import { getText } from '../lib/texts.js';
import { mainMenuKeyboard } from '../lib/ui.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

const execFileAsync = promisify(execFile);

const WORK_DIR = '/tmp/sulduz-downloads/voice';
const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

export async function handleVoiceToMp3(ctx: Context) {
  const voice = ctx.message && 'voice' in ctx.message ? ctx.message.voice : undefined;
  if (!voice) return;

  await convertToAudio(ctx, voice.file_id, voice.file_size, voice.duration);
}

export async function handleAudioToVoice(ctx: Context) {
  const msg = ctx.message;
  if (!msg) return;

  let fileId: string | undefined;
  let fileSize: number | undefined;
  let duration: number | undefined;

  if ('audio' in msg && msg.audio) {
    fileId = msg.audio.file_id;
    fileSize = msg.audio.file_size;
    duration = msg.audio.duration;
  } else if ('document' in msg && msg.document) {
    const doc = msg.document;
    const isMp3 = doc.mime_type === 'audio/mpeg' || /\.mp3$/i.test(doc.file_name || '');
    if (!isMp3) return;
    fileId = doc.file_id;
    fileSize = doc.file_size;
  }

  if (!fileId) return;

  await convertToVoice(ctx, fileId, fileSize, duration);
}

export async function sendVoiceHelp(ctx: Context) {
  const enabled = await getSettingBool('voice_converter_enabled');
  if (!enabled) {
    await ctx.reply(await getText('voice.disabled'), await mainMenuKeyboard());
    return;
  }

  await ctx.reply(await getText('voice.help'), await mainMenuKeyboard());
}

function botTag(ctx: Context): string {
  const username = (ctx.botInfo?.username || '').replace(/^@/, '');
  return username ? `\n🤖 @${username}` : '';
}

function formatDuration(seconds?: number) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function prepare(ctx: Context): Promise<{ maxMb: number; maxSeconds: number } | null> {
  if (!(await getSettingBool('voice_converter_enabled'))) {
    await ctx.reply(await getText('voice.disabled'), await mainMenuKeyboard());
    return null;
  }

  const maxMb = (await getSettingNumber('voice_convert_max_mb')) || 20;
  const maxSeconds = (await getSettingNumber('voice_convert_max_seconds')) || 600;

  return { maxMb: Math.min(maxMb, 20), maxSeconds };
}

async function downloadFile(ctx: Context, fileId: string, dest: string) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await axios.get(link.href, {
    responseType: 'arraybuffer',
    timeout: 120_000,
    maxContentLength: TELEGRAM_DOWNLOAD_LIMIT,
  });
  fs.writeFileSync(dest, Buffer.from(res.data));
}

function cleanup(...files: string[]) {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // ignore
    }
  }
}

async function checkLimits(
  ctx: Context,
  limits: { maxMb: number; maxSeconds: number },
  fileSize?: number,
  duration?: number
): Promise<boolean> {
  if (fileSize && fileSize > limits.maxMb * 1024 * 1024) {
    await ctx.reply(await getText('voice.too_big', { mb: limits.maxMb }), await mainMenuKeyboard());
    return false;
  }
  if (duration && duration > limits.maxSeconds) {
    await ctx.reply(
      await getText('voice.too_long', { minutes: Math.floor(limits.maxSeconds / 60) }),
      await mainMenuKeyboard()
    );
    return false;
  }
  return true;
}

async function convertToAudio(
  ctx: Context,
  fileId: string,
  fileSize: number | undefined,
  duration: number | undefined
) {
  const limits = await prepare(ctx);
  if (!limits) return;
  if (!(await checkLimits(ctx, limits, fileSize, duration))) return;

  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  const base = path.join(WORK_DIR, `${ctx.from!.id}_${Date.now()}`);
  const input = `${base}_in.ogg`;
  const output = `${base}_out.mp3`;

  try {
    await downloadFile(ctx, fileId, input);
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '1', output],
      { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 }
    );

    const stats = fs.statSync(output);
    if (stats.size > 50 * 1024 * 1024) {
      await ctx.reply(await getText('voice.mp3_too_big'), await mainMenuKeyboard());
      return;
    }

    const caption =
      (await getText('voice.to_mp3', { duration: formatDuration(duration) || '—' })) + botTag(ctx);

    await ctx.replyWithAudio(
      { source: output, filename: 'sulduz-voice.mp3' },
      {
        title: 'ویس تبدیل‌شده',
        performer: 'Sulduz Bot',
        caption,
        ...(await mainMenuKeyboard()),
      }
    );
  } catch (error) {
    console.error('Voice to MP3 error:', error);
    await ctx.reply(await getText('voice.error'), await mainMenuKeyboard());
  } finally {
    cleanup(input, output);
  }
}

async function convertToVoice(
  ctx: Context,
  fileId: string,
  fileSize: number | undefined,
  duration: number | undefined
) {
  const limits = await prepare(ctx);
  if (!limits) return;
  if (!(await checkLimits(ctx, limits, fileSize, duration))) return;

  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  const base = path.join(WORK_DIR, `${ctx.from!.id}_${Date.now()}`);
  const input = `${base}_in.src`;
  const output = `${base}_out.ogg`;

  try {
    await downloadFile(ctx, fileId, input);
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i', input,
        '-vn',
        '-c:a', 'libopus',
        '-b:a', '64k',
        '-ar', '48000',
        '-ac', '1',
        '-application', 'voip',
        '-f', 'ogg',
        output,
      ],
      { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 }
    );

    const stats = fs.statSync(output);
    const caption =
      (await getText('voice.to_voice', { size: (stats.size / 1024 / 1024).toFixed(1) })) + botTag(ctx);

    await ctx.replyWithVoice({ source: output }, { caption, ...(await mainMenuKeyboard()) });
  } catch (error) {
    console.error('MP3 to voice error:', error);
    await ctx.reply(await getText('voice.error'), await mainMenuKeyboard());
  } finally {
    cleanup(input, output);
  }
}
