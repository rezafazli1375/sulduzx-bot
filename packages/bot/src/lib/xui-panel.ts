import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { getSetting } from './settings.js';

interface XuiClientStat {
  id: number;
  inboundId: number;
  enable: boolean;
  email: string;
  up: number;
  down: number;
  expiryTime: number;
  total: number;
}

interface XuiInbound {
  id: number;
  remark: string;
  port: number;
  protocol: string;
  enable: boolean;
  expiryTime: number;
  total: number;
  settings: any;
  streamSettings: any;
  clientStats: XuiClientStat[];
}

interface ServerStatus {
  online: boolean;
  cpu: number;
  mem: number;
  xrayRunning: boolean;
  uptime: number;
}

export class XuiPanelClient {
  private http: AxiosInstance;
  private cookies = new Map<string, string>();
  private csrf = '';
  private lastLogin = 0;

  constructor(
    private baseUrl: string,
    private username: string,
    private password: string
  ) {
    this.http = axios.create({
      baseURL: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 20000,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
  }

  private storeCookies(setCookie?: string[]) {
    if (!setCookie) return;
    for (const raw of setCookie) {
      const pair = raw.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx > 0) {
        this.cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
    }
  }

  private cookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private extractCsrf(html: string): string {
    const match = html.match(/name="csrf-token"\s+content="([^"]+)"/);
    return match ? match[1] : '';
  }

  private async ensureLogin(): Promise<void> {
    if (this.csrf && Date.now() - this.lastLogin < 25 * 60 * 1000) return;

    this.cookies.clear();

    const page = await this.http.get('');
    this.storeCookies(page.headers['set-cookie'] as string[] | undefined);
    const loginCsrf = this.extractCsrf(typeof page.data === 'string' ? page.data : '');
    if (!loginCsrf) {
      throw new Error('Panel login page unavailable (no CSRF token)');
    }

    const res = await this.http.post(
      'login',
      { username: this.username, password: this.password },
      {
        headers: {
          'X-CSRF-Token': loginCsrf,
          Cookie: this.cookieHeader(),
        },
      }
    );
    this.storeCookies(res.headers['set-cookie'] as string[] | undefined);

    if (!res.data?.success) {
      throw new Error(`Panel login failed: ${res.data?.msg || 'unknown error'}`);
    }

    const panel = await this.http.get('panel/', {
      headers: { Cookie: this.cookieHeader() },
    });
    this.storeCookies(panel.headers['set-cookie'] as string[] | undefined);
    const panelCsrf = this.extractCsrf(typeof panel.data === 'string' ? panel.data : '');
    if (!panelCsrf) {
      throw new Error('Panel dashboard unavailable (no CSRF token after login)');
    }

    this.csrf = panelCsrf;
    this.lastLogin = Date.now();
  }

  private async request<T = any>(
    method: 'GET' | 'POST',
    path: string,
    data?: any
  ): Promise<T> {
    await this.ensureLogin();

    const headers: Record<string, string> = { Cookie: this.cookieHeader() };
    if (method !== 'GET') headers['X-CSRF-Token'] = this.csrf;

    let res = await this.http.request({
      method,
      url: path,
      data,
      headers,
    });

    if (res.status === 403 || (res.data && res.data.success === false && /login/i.test(String(res.data.msg || '')))) {
      this.csrf = '';
      this.lastLogin = 0;
      await this.ensureLogin();
      headers.Cookie = this.cookieHeader();
      if (method !== 'GET') headers['X-CSRF-Token'] = this.csrf;
      res = await this.http.request({ method, url: path, data, headers });
    }

    if (res.data && typeof res.data === 'object' && 'success' in res.data) {
      if (!res.data.success) {
        throw new Error(res.data.msg || 'Panel request failed');
      }
      return res.data.obj as T;
    }

    throw new Error(`Unexpected panel response (${res.status})`);
  }

  async getInbounds(): Promise<XuiInbound[]> {
    return (await this.request<XuiInbound[]>('GET', 'panel/api/inbounds/list')) || [];
  }

  async getInbound(inboundId: number): Promise<XuiInbound> {
    const inbound = (await this.getInbounds()).find((i) => i.id === inboundId);
    if (!inbound) throw new Error(`Inbound ${inboundId} not found`);
    return inbound;
  }

  async addClient(inboundId: number, client: {
    email: string;
    id?: string;
    totalGB: number;
    expiryTime: number;
    enable: boolean;
    limitIp?: number;
  }): Promise<void> {
    await this.request('POST', 'panel/api/clients/add', {
      inboundIds: [inboundId],
      client: {
        id: client.id,
        email: client.email,
        flow: '',
        limitIp: client.limitIp ?? 0,
        totalGB: client.totalGB,
        expiryTime: client.expiryTime,
        enable: client.enable,
        tgId: 0,
        reset: 0,
      },
    });
  }

  async getClientLinks(email: string): Promise<string[]> {
    return (
      (await this.request<string[]>(
        'GET',
        `panel/api/clients/links/${encodeURIComponent(email)}`
      )) || []
    );
  }

  async deleteClient(email: string): Promise<void> {
    await this.request('POST', `panel/api/clients/del/${encodeURIComponent(email)}`, {});
  }

  async getServerStatus(): Promise<ServerStatus> {
    try {
      const obj = await this.request<any>('GET', 'panel/api/server/status');
      const memCurrent = obj?.mem?.current || 0;
      const memTotal = obj?.mem?.total || 0;
      return {
        online: true,
        cpu: Math.round(obj?.cpu || 0),
        mem: memTotal > 0 ? Math.round((memCurrent / memTotal) * 100) : 0,
        xrayRunning: obj?.xray?.state === 'running',
        uptime: obj?.uptime || 0,
      };
    } catch {
      return { online: false, cpu: 0, mem: 0, xrayRunning: false, uptime: 0 };
    }
  }
}

export interface PanelConfig {
  baseUrl: string;
  username: string;
  password: string;
  inboundId: number;
}

export async function getPanelConfig(): Promise<PanelConfig> {
  const [baseUrl, username, password, inboundIdRaw] = await Promise.all([
    getSetting('panel_base_url'),
    getSetting('panel_username'),
    getSetting('panel_password'),
    getSetting('panel_inbound_id'),
  ]);

  const config = {
    baseUrl: (baseUrl || process.env.PANEL_BASE_URL || '').trim(),
    username: (username || process.env.PANEL_USERNAME || '').trim(),
    password: password || process.env.PANEL_PASSWORD || '',
    inboundId: parseInt(inboundIdRaw || process.env.PANEL_INBOUND_ID || '11', 10),
  };

  if (!config.baseUrl || !config.username || !config.password) {
    throw new Error('تنظیمات پنل x-ui در پنل مدیریت کامل نیست');
  }

  return config;
}

let cachedClient: { key: string; client: XuiPanelClient } | null = null;

export async function getPanelClient(): Promise<XuiPanelClient> {
  const config = await getPanelConfig();
  const key = `${config.baseUrl}|${config.username}|${config.password}`;

  if (!cachedClient || cachedClient.key !== key) {
    cachedClient = {
      key,
      client: new XuiPanelClient(config.baseUrl, config.username, config.password),
    };
  }

  return cachedClient.client;
}

export async function getPanelInboundId(): Promise<number> {
  return (await getPanelConfig()).inboundId;
}
