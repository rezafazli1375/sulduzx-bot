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

const WORK_DIR = '/tmp/sulduz-downloads/convert';
const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const WORD_EXTENSIONS = new Set(['.doc', '.docx', '.odt', '.rtf']);
const WORD_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
]);

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v', '.mpg', '.mpeg', '.ts']);

type TelegramDocument = {
  file_id: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
};

export function isWordDocument(doc: TelegramDocument): boolean {
  const ext = path.extname(doc.file_name || '').toLowerCase();
  if (WORD_EXTENSIONS.has(ext)) return true;
  return WORD_MIME_TYPES.has(doc.mime_type || '');
}

export function isVideoDocument(doc: TelegramDocument): boolean {
  const ext = path.extname(doc.file_name || '').toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return true;
  return (doc.mime_type || '').startsWith('video/');
}

function botTag(ctx: Context): string {
  const username = (ctx.botInfo?.username || '').replace(/^@/, '');
  return username ? `\n🤖 @${username}` : '';
}

function safeBaseName(name: string): string {
  const base = path.basename(name || '', path.extname(name || '')).trim();
  const cleaned = base.replace(/[\\/:*?"<>|\r\n]+/g, '-').slice(0, 80);
  return cleaned || 'sulduz';
}

async function maxSizeMb(key: string): Promise<number> {
  const configured = (await getSettingNumber(key)) || 20;
  return Math.max(1, Math.min(configured, 20));
}

async function ensureWorkDir(): Promise<void> {
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });
}

async function downloadFile(ctx: Context, fileId: string, dest: string) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await axios.get(link.href, {
    responseType: 'arraybuffer',
    timeout: 180_000,
    maxContentLength: TELEGRAM_DOWNLOAD_LIMIT,
  });
  fs.writeFileSync(dest, Buffer.from(res.data));
}

function cleanup(...targets: string[]) {
  for (const target of targets) {
    try {
      if (!fs.existsSync(target)) continue;
      if (fs.statSync(target).isDirectory()) fs.rmSync(target, { recursive: true, force: true });
      else fs.unlinkSync(target);
    } catch {
      // ignore
    }
  }
}

// LibreOffice cannot run two conversions with the same profile at once; serialize jobs.
let libreOfficeChain: Promise<unknown> = Promise.resolve();

function convertWithLibreOffice(input: string, outDir: string): Promise<void> {
  const profile = path.join(WORK_DIR, `lo-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const task = libreOfficeChain.then(async () => {
    try {
      await execFileAsync(
        'soffice',
        [
          '--headless',
          '--norestore',
          '--nolockcheck',
          '--nodefault',
          `-env:UserInstallation=file://${profile}`,
          '--convert-to',
          'pdf:writer_pdf_Export',
          '--outdir',
          outDir,
          input,
        ],
        {
          timeout: 180_000,
          maxBuffer: 20 * 1024 * 1024,
          env: { ...process.env, HOME: '/tmp' },
        }
      );
    } finally {
      cleanup(profile);
    }
  });

  libreOfficeChain = task.catch(() => undefined);
  return task;
}

export async function sendWordToPdfHelp(ctx: Context) {
  if (!(await getSettingBool('word_pdf_enabled'))) {
    await ctx.reply(await getText('word_pdf.disabled'), await mainMenuKeyboard());
    return;
  }

  const mb = await maxSizeMb('word_pdf_max_mb');
  await ctx.reply(await getText('word_pdf.help', { mb }), await mainMenuKeyboard());
}

export async function sendVideoToMp3Help(ctx: Context) {
  if (!(await getSettingBool('video_mp3_enabled'))) {
    await ctx.reply(await getText('video_mp3.disabled'), await mainMenuKeyboard());
    return;
  }

  const mb = await maxSizeMb('video_mp3_max_mb');
  await ctx.reply(await getText('video_mp3.help', { mb }), await mainMenuKeyboard());
}

export async function handleWordToPdf(ctx: Context, doc: TelegramDocument) {
  if (!(await getSettingBool('word_pdf_enabled'))) {
    await ctx.reply(await getText('word_pdf.disabled'), await mainMenuKeyboard());
    return;
  }

  if (!isWordDocument(doc)) {
    await ctx.reply(await getText('word_pdf.unsupported'), await mainMenuKeyboard());
    return;
  }

  const mb = await maxSizeMb('word_pdf_max_mb');
  if (doc.file_size && doc.file_size > mb * 1024 * 1024) {
    await ctx.reply(await getText('word_pdf.too_big', { mb }), await mainMenuKeyboard());
    return;
  }

  await ensureWorkDir();

  const stamp = `${ctx.from!.id}_${Date.now()}`;
  const outDir = path.join(WORK_DIR, `job_${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const ext = (path.extname(doc.file_name || '') || '.docx').toLowerCase();
  const input = path.join(outDir, `source${ext}`);
  const displayName = safeBaseName(doc.file_name || 'document');

  try {
    await downloadFile(ctx, doc.file_id, input);
    await convertWithLibreOffice(input, outDir);

    const pdf = path.join(outDir, `source.pdf`);
    if (!fs.existsSync(pdf)) throw new Error('PDF output was not created');

    const size = fs.statSync(pdf).size;
    if (size > MAX_UPLOAD_BYTES) throw new Error('PDF output is too large');

    const caption = (await getText('word_pdf.success')) + botTag(ctx);

    await ctx.replyWithDocument(
      { source: pdf, filename: `${displayName}.pdf` },
      { caption, ...(await mainMenuKeyboard()) }
    );
  } catch (error) {
    console.error('Word to PDF error:', error);
    await ctx.reply(await getText('word_pdf.error'), await mainMenuKeyboard());
  } finally {
    cleanup(outDir);
  }
}

export async function handleVideoToMp3(
  ctx: Context,
  source: { fileId: string; fileSize?: number; fileName?: string; duration?: number }
) {
  if (!(await getSettingBool('video_mp3_enabled'))) {
    await ctx.reply(await getText('video_mp3.disabled'), await mainMenuKeyboard());
    return;
  }

  const mb = await maxSizeMb('video_mp3_max_mb');
  if (source.fileSize && source.fileSize > mb * 1024 * 1024) {
    await ctx.reply(await getText('video_mp3.too_big', { mb }), await mainMenuKeyboard());
    return;
  }

  await ensureWorkDir();

  const stamp = `${ctx.from!.id}_${Date.now()}`;
  const input = path.join(WORK_DIR, `video_${stamp}.src`);
  const output = path.join(WORK_DIR, `video_${stamp}.mp3`);

  try {
    await downloadFile(ctx, source.fileId, input);

    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i', input,
        '-vn',
        '-map', '0:a:0?',
        '-c:a', 'libmp3lame',
        '-b:a', '192k',
        '-ar', '44100',
        output,
      ],
      { timeout: 600_000, maxBuffer: 20 * 1024 * 1024 }
    );

    if (!fs.existsSync(output) || fs.statSync(output).size < 1024) {
      await ctx.reply(await getText('video_mp3.no_audio'), await mainMenuKeyboard());
      return;
    }

    if (fs.statSync(output).size > MAX_UPLOAD_BYTES) throw new Error('MP3 output is too large');

    const title = safeBaseName(source.fileName || 'video');
    const caption = (await getText('video_mp3.success')) + botTag(ctx);

    await ctx.replyWithAudio(
      { source: output, filename: `${title}.mp3` },
      {
        title,
        performer: 'Sulduz Bot',
        caption,
        ...(await mainMenuKeyboard()),
      }
    );
  } catch (error) {
    console.error('Video to MP3 error:', error);
    const hasOutput = fs.existsSync(output) && fs.statSync(output).size >= 1024;
    const message = hasOutput ? 'video_mp3.error' : 'video_mp3.no_audio';
    await ctx.reply(await getText(message), await mainMenuKeyboard());
  } finally {
    cleanup(input, output);
  }
}
