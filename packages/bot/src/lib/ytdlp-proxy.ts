import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import { getSetting, getSettingBool } from './settings.js';

const execFileAsync = promisify(execFile);

const XRAY_BIN = process.env.XRAY_BIN || 'xray';
const XRAY_CONFIG_PATH = '/tmp/sulduzx-xray.json';
const XRAY_SOCKS_PORT = Number(process.env.XRAY_SOCKS_PORT || 1081);
const XRAY_PROXY_URL = `socks5h://127.0.0.1:${XRAY_SOCKS_PORT}`;
const MAX_CONFIG_LENGTH = 20000;

type Json = Record<string, any>;

export type ProxyMode = 'off' | 'socks' | 'v2ray';

export interface ProxySettings {
  mode: ProxyMode;
  url: string;
  v2ray: string;
}

export interface ProxyTestResult {
  ok: boolean;
  proxy?: string;
  latencyMs: number;
  exitIp?: string;
  youtubeStatus?: number;
  error?: string;
}

function scrub(value: any): any {
  if (Array.isArray(value)) {
    return value.map(scrub).filter((v) => v !== undefined);
  }
  if (value && typeof value === 'object') {
    const out: Json = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = scrub(val);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return value;
}

function splitOnce(value: string, sep: string): [string, string] {
  const idx = value.indexOf(sep);
  if (idx < 0) throw new Error(`Invalid link: missing "${sep}"`);
  return [value.slice(0, idx), value.slice(idx + sep.length)];
}

function splitHostPort(value: string): [string, number] {
  const trimmed = value.replace(/\/+$/, '');
  let host = '';
  let port = '';
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    host = trimmed.slice(1, end);
    port = trimmed.slice(end + 1).replace(/^:/, '');
  } else {
    const idx = trimmed.lastIndexOf(':');
    if (idx < 0) throw new Error('Invalid link: missing port');
    host = trimmed.slice(0, idx);
    port = trimmed.slice(idx + 1);
  }
  const parsed = Number(port);
  if (!host || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('Invalid link: bad address or port');
  }
  return [host, parsed];
}

function tryBase64(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    return decoded && /^[\x20-\x7e\s]+$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function pickStreamSettings(params: URLSearchParams, defaultSecurity = 'none'): Json {
  const network = (params.get('type') || params.get('network') || 'tcp').toLowerCase();
  const security = (params.get('security') || defaultSecurity || 'none').toLowerCase();
  const host = params.get('host') || '';
  const pathValue = params.get('path') ? decodeURIComponent(params.get('path') as string) : '';
  const serviceName = params.get('serviceName') || '';
  const sni = params.get('sni') || host;
  const alpn = params.get('alpn');

  const stream: Json = { network, security };

  if (security === 'tls') {
    stream.tlsSettings = {
      serverName: sni || undefined,
      fingerprint: params.get('fp') || undefined,
      allowInsecure: params.get('allowInsecure') === '1' || params.get('allowInsecure') === 'true',
      alpn: alpn ? alpn.split(',').filter(Boolean) : undefined,
    };
  } else if (security === 'reality') {
    stream.realitySettings = {
      serverName: sni || undefined,
      fingerprint: params.get('fp') || 'chrome',
      publicKey: params.get('pbk') || undefined,
      shortId: params.get('sid') || '',
      spiderX: params.get('spx') || '',
    };
  }

  if (network === 'ws' || network === 'httpupgrade') {
    stream.wsSettings = {
      path: pathValue || '/',
      headers: host ? { Host: host } : undefined,
    };
  } else if (network === 'grpc') {
    stream.grpcSettings = { serviceName: serviceName || pathValue || '' };
  } else if (network === 'h2' || network === 'http') {
    stream.httpSettings = {
      host: host ? [host] : undefined,
      path: pathValue || '/',
    };
  } else if (network === 'tcp' && params.get('headerType') === 'http') {
    stream.tcpSettings = {
      header: {
        type: 'http',
        request: {
          path: pathValue ? [pathValue] : ['/'],
          headers: host ? { Host: [host] } : undefined,
        },
      },
    };
  }

  return scrub(stream);
}

function parseVless(raw: string): Json {
  const url = new URL(raw);
  const id = decodeURIComponent(url.username);
  if (!id) throw new Error('VLESS link has no UUID');
  const flow = url.searchParams.get('flow') || '';
  const port = Number(url.port || 443);

  return {
    protocol: 'vless',
    settings: {
      vnext: [
        {
          address: url.hostname,
          port,
          users: [{ id, encryption: 'none', flow: flow || undefined }],
        },
      ],
    },
    streamSettings: pickStreamSettings(url.searchParams),
  };
}

function parseVmess(raw: string): Json {
  const body = raw.slice('vmess://'.length).split('#')[0].trim();
  const decoded = tryBase64(body);
  if (!decoded) throw new Error('VMess link is not valid base64');

  let parsed: Json;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('VMess link does not contain valid JSON');
  }

  if (!parsed.add || !parsed.id) throw new Error('VMess link is missing address or id');
  const net = String(parsed.net || 'tcp').toLowerCase();
  const tls = String(parsed.tls || '').toLowerCase();
  const sec = tls === 'tls' || tls === 'reality' ? tls : 'none';

  const stream: Json = { network: net, security: sec };
  if (sec === 'tls') {
    stream.tlsSettings = {
      serverName: parsed.sni || parsed.host || undefined,
      fingerprint: parsed.fp || undefined,
      alpn: parsed.alpn ? String(parsed.alpn).split(',').filter(Boolean) : undefined,
      allowInsecure: parsed.allowInsecure === true || parsed.allowInsecure === '1',
    };
  }
  if (net === 'ws') {
    stream.wsSettings = {
      path: parsed.path || '/',
      headers: parsed.host ? { Host: parsed.host } : undefined,
    };
  } else if (net === 'grpc') {
    stream.grpcSettings = { serviceName: parsed.path || '' };
  } else if (net === 'h2' || net === 'http') {
    stream.httpSettings = {
      host: parsed.host ? [parsed.host] : undefined,
      path: parsed.path || '/',
    };
  } else if (net === 'tcp' && parsed.type === 'http') {
    stream.tcpSettings = {
      header: {
        type: 'http',
        request: {
          path: parsed.path ? [parsed.path] : ['/'],
          headers: parsed.host ? { Host: [parsed.host] } : undefined,
        },
      },
    };
  }

  return {
    protocol: 'vmess',
    settings: {
      vnext: [
        {
          address: parsed.add,
          port: Number(parsed.port || 443),
          users: [
            {
              id: parsed.id,
              alterId: Number(parsed.aid || 0),
              security: parsed.scy || 'auto',
            },
          ],
        },
      ],
    },
    streamSettings: scrub(stream),
  };
}

function parseTrojan(raw: string): Json {
  const url = new URL(raw);
  const password = decodeURIComponent(url.username);
  if (!password) throw new Error('Trojan link has no password');

  return {
    protocol: 'trojan',
    settings: {
      servers: [
        {
          address: url.hostname,
          port: Number(url.port || 443),
          password,
        },
      ],
    },
    streamSettings: pickStreamSettings(url.searchParams, 'tls'),
  };
}

function parseShadowsocks(raw: string): Json {
  const body = raw.slice('ss://'.length).split('#')[0].trim();
  const queryIdx = body.indexOf('?');
  const main = queryIdx >= 0 ? body.slice(0, queryIdx) : body;

  let method = '';
  let password = '';
  let host = '';
  let port = 0;

  if (main.includes('@')) {
    const [userinfo, hostport] = splitOnce(main, '@');
    const plain = userinfo.includes(':') ? decodeURIComponent(userinfo) : tryBase64(userinfo);
    if (!plain) throw new Error('Shadowsocks link has invalid credentials');
    [method, password] = splitOnce(plain, ':');
    [host, port] = splitHostPort(hostport);
  } else {
    const plain = tryBase64(main);
    if (!plain) throw new Error('Shadowsocks link is not valid base64');
    const [userinfo, hostport] = splitOnce(plain, '@');
    [method, password] = splitOnce(userinfo, ':');
    [host, port] = splitHostPort(hostport);
  }

  if (!method || !password) throw new Error('Shadowsocks link is missing method or password');

  return {
    protocol: 'shadowsocks',
    settings: {
      servers: [{ address: host, port, method, password }],
    },
  };
}

function parseJsonConfig(raw: string): Json {
  let parsed: Json;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Config is not valid JSON');
  }

  if (Array.isArray(parsed?.outbounds)) {
    const outbound = parsed.outbounds.find(
      (item: Json) => item && !['freedom', 'blackhole', 'dns'].includes(String(item.protocol))
    );
    if (!outbound) throw new Error('Config has no usable outbound');
    return scrub(outbound);
  }

  if (parsed?.protocol) {
    return scrub(parsed);
  }

  throw new Error('JSON must be an xray outbound or a full config with outbounds');
}

const SUPPORTED_PROTOCOLS = ['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http'];

export function parseProxyToOutbound(rawInput: string): Json {
  const raw = String(rawInput || '').trim();
  if (!raw) throw new Error('Config is empty');
  if (raw.length > MAX_CONFIG_LENGTH) throw new Error('Config is too large');

  const lower = raw.toLowerCase();
  let outbound: Json;

  if (raw.startsWith('{')) {
    outbound = parseJsonConfig(raw);
  } else if (lower.startsWith('vless://')) {
    outbound = parseVless(raw);
  } else if (lower.startsWith('vmess://')) {
    outbound = parseVmess(raw);
  } else if (lower.startsWith('trojan://')) {
    outbound = parseTrojan(raw);
  } else if (lower.startsWith('ss://')) {
    outbound = parseShadowsocks(raw);
  } else {
    throw new Error('Unsupported config. Use vless://, vmess://, trojan://, ss:// or xray JSON');
  }

  if (!SUPPORTED_PROTOCOLS.includes(String(outbound.protocol))) {
    throw new Error(`Unsupported outbound protocol: ${outbound.protocol}`);
  }

  return outbound;
}

export function buildXrayConfig(rawInput: string, socksPort = XRAY_SOCKS_PORT): Json {
  return {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        tag: 'socks-in',
        listen: '127.0.0.1',
        port: socksPort,
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
      },
    ],
    outbounds: [parseProxyToOutbound(rawInput)],
  };
}

let child: ChildProcess | null = null;
let activeHash = '';
let stderrTail = '';
let queue: Promise<void> = Promise.resolve();

function stopXray(): void {
  const proc = child;
  child = null;
  activeHash = '';
  if (proc && proc.exitCode === null) {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

process.on('exit', stopXray);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopXray();
    process.exit(0);
  });
}

function canConnect(port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port, 500)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function assertXrayAvailable(): Promise<void> {
  try {
    await execFileAsync(XRAY_BIN, ['version'], { timeout: 5000 });
  } catch {
    throw new Error('xray-core is not installed in the bot image. Rebuild it with "docker compose build bot".');
  }
}

async function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
  if (proc.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForPortFree(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && (await canConnect(port, 250))) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function startXray(config: Json, hash: string): Promise<void> {
  if (child && child.exitCode === null && activeHash === hash && (await canConnect(XRAY_SOCKS_PORT))) {
    return;
  }

  const previous = child;
  stopXray();
  if (previous) {
    await waitForExit(previous, 3000);
  }
  // The old listener can outlive its process briefly; binding too early makes the
  // new xray exit while the port still answers, which looks like a false success.
  await waitForPortFree(XRAY_SOCKS_PORT, 2000);

  await assertXrayAvailable();

  fs.writeFileSync(XRAY_CONFIG_PATH, JSON.stringify(config), { mode: 0o600 });
  stderrTail = '';

  const proc = spawn(XRAY_BIN, ['run', '-c', XRAY_CONFIG_PATH], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child = proc;
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000);
  });
  proc.on('error', (error) => {
    stderrTail = (stderrTail + String(error.message || error)).slice(-4000);
  });
  proc.on('exit', () => {
    if (child === proc) {
      child = null;
      activeHash = '';
    }
  });

  const ready = await waitForPort(XRAY_SOCKS_PORT, 8000);
  if (!ready || proc.exitCode !== null) {
    const detail = stderrTail.trim();
    stopXray();
    throw new Error(detail ? `xray failed to start: ${detail}` : 'xray failed to start (timeout)');
  }

  activeHash = hash;
}

export function ensureV2rayProxy(rawConfig: string): Promise<string> {
  const config = buildXrayConfig(rawConfig);
  const hash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');

  const run = async (): Promise<void> => {
    await startXray(config, hash);
  };
  const task = queue.then(run, run);
  queue = task.then(
    () => undefined,
    () => undefined
  );
  return task.then(() => XRAY_PROXY_URL);
}

export function normalizeProxyUrl(url: string): string {
  const value = String(url || '').trim();
  if (!value) throw new Error('Proxy URL is empty');
  if (/^(https?|socks4a?|socks5h?):\/\//i.test(value)) return value;
  return `socks5h://${value}`;
}

export async function getProxySettings(): Promise<ProxySettings> {
  const modeRaw = ((await getSetting('ytdlp_proxy_mode')) || '').trim().toLowerCase();
  const url = ((await getSetting('ytdlp_proxy_url')) || '').trim();
  const v2ray = ((await getSetting('ytdlp_v2ray_config')) || '').trim();

  let mode: ProxyMode;
  if (modeRaw === 'socks' || modeRaw === 'v2ray' || modeRaw === 'off') {
    mode = modeRaw;
  } else {
    const legacyEnabled = await getSettingBool('ytdlp_proxy_enabled');
    mode = legacyEnabled && url ? 'socks' : 'off';
  }

  return { mode, url, v2ray };
}

export async function getDownloaderProxy(): Promise<string | undefined> {
  const { mode, url, v2ray } = await getProxySettings();

  if (mode === 'socks' && url) {
    return normalizeProxyUrl(url);
  }
  if (mode === 'v2ray' && v2ray) {
    return ensureV2rayProxy(v2ray);
  }
  return process.env.YTDLP_PROXY || undefined;
}

async function runCurl(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('curl', args, { timeout: 30000, maxBuffer: 64 * 1024 });
  return stdout;
}

function shortError(error: any): string {
  const text = String(error?.stderr || error?.message || error || '').trim();
  return text.slice(0, 300) || 'unknown error';
}

export async function testProxy(input: {
  mode: 'socks' | 'v2ray';
  url?: string;
  v2rayConfig?: string;
}): Promise<ProxyTestResult> {
  const started = Date.now();
  let proxy = '';

  try {
    proxy =
      input.mode === 'v2ray'
        ? await ensureV2rayProxy(String(input.v2rayConfig || ''))
        : normalizeProxyUrl(String(input.url || ''));
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: shortError(error) };
  }

  let exitIp = '';
  try {
    exitIp = (await runCurl(['-fsS', '--max-time', '15', '-x', proxy, 'https://api.ipify.org'])).trim();
  } catch (error) {
    return { ok: false, proxy, latencyMs: Date.now() - started, error: shortError(error) };
  }

  let youtubeStatus: number | undefined;
  try {
    const code = await runCurl([
      '-sS',
      '--max-time',
      '20',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      '-x',
      proxy,
      'https://www.youtube.com/generate_204',
    ]);
    const parsed = Number(code.trim());
    if (Number.isInteger(parsed) && parsed > 0) youtubeStatus = parsed;
  } catch {
    /* youtube check is best-effort */
  }

  return {
    ok: true,
    proxy,
    latencyMs: Date.now() - started,
    exitIp: /^\d{1,3}(\.\d{1,3}){3}$/.test(exitIp) ? exitIp : undefined,
    youtubeStatus,
  };
}
