/**
 * Xtream Codes API client: login, categories, live/VOD/series lists, series
 * info and stream URLs. Lists are cached (shared in-flight requests, 12 min
 * TTL) and refreshed in the background every 10 minutes; views are told what
 * changed through the `app:content-updated` window event.
 */

export interface XtreamUser {
  username: string;
  status: string;
  exp_date: string;
  active_cons: number;
  max_connections: number;
  server_url: string;
}

export interface Category {
  category_id: string;
  category_name: string;
}

export const EVENTS = {
  contentUpdated: 'app:content-updated',
  historyUpdated: 'app:history-updated',
  authChanged: 'app:auth-changed',
} as const;

const CREDS_KEY = 'creds_key';
const LIST_TTL = 12 * 60 * 1000;
const REFRESH_EVERY = 10 * 60 * 1000;

interface CacheEntry {
  at: number;
  data: any[];
  text: string;
  post?: (list: any[]) => any[];
}

class ApiService {
  serverUrl = '';
  username = '';
  password = '';
  user: XtreamUser | null = null;
  private coverCache = new Map<string, string>();
  private listCache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<any[]>>();

  constructor() {
    this.loadSession();
  }

  get isLoggedIn(): boolean {
    return !!(this.serverUrl && this.username);
  }

  /** Stable per-account key (host_port_user) used to scope watch history. */
  getAccountKey(): string {
    const s = this.serverUrl.trim().toLowerCase();
    const u = this.username.trim().toLowerCase();
    if (!s && !u) return 'guest';
    let host = 'server';
    try {
      const parsed = new URL(s);
      host = parsed.hostname.replace(/[^a-zA-Z0-9]/g, '_') + (parsed.port ? `_${parsed.port}` : '');
    } catch {
      host = s.replace(/[^a-zA-Z0-9]/g, '_').slice(-20);
    }
    return `${host}_${u.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  /** Rewrites panel-local image URLs (loopback addresses, /p/...) to the server the user logged into. */
  normalizeImageUrl(url?: string): string {
    if (!url) return '';
    let clean = String(url).trim();
    if (this.serverUrl) {
      clean = clean.replace(/https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/g, this.serverUrl);
      if (clean.startsWith('/p/')) clean = this.serverUrl + clean;
      else if (clean.startsWith('p/')) clean = `${this.serverUrl}/${clean}`;
    }
    return clean;
  }

  /** True when the app's own server offers /img (see image-proxy.ts); set by detectImageProxy. */
  private imageProxy = false;

  detectImageProxy(): Promise<void> {
    return fetch('./img')
      .then((r) => {
        this.imageProxy = r.headers.get('x-image-proxy') === '1';
      })
      .catch(() => {});
  }

  /** Channel logos come from third-party hosts the TV may not reach; go through our server when it can fetch them. */
  logoUrl(url?: string): string {
    const clean = this.normalizeImageUrl(url);
    return this.imageProxy && /^https?:\/\//i.test(clean) ? `./img?u=${encodeURIComponent(clean)}` : clean;
  }

  getCachedCover(seriesId: string | number): string {
    return this.coverCache.get(String(seriesId)) || '';
  }

  setCachedCover(seriesId: string | number, url: string) {
    if (seriesId && url) this.coverCache.set(String(seriesId), this.normalizeImageUrl(url));
  }

  private loadSession() {
    try {
      const saved = localStorage.getItem(CREDS_KEY);
      if (!saved) return;
      const p = JSON.parse(saved);
      if (p.serverUrl) this.serverUrl = p.serverUrl;
      if (p.username) this.username = p.username;
      if (p.password) this.password = p.password;
      if (p.user) this.user = p.user;
    } catch {
      // corrupt session: start logged out
    }
  }

  private saveSession(serverUrl: string, user: string, pass: string, info: XtreamUser) {
    this.serverUrl = serverUrl;
    this.username = user;
    this.password = pass;
    this.user = info;
    this.coverCache.clear();
    this.listCache.clear();
    try {
      localStorage.setItem(CREDS_KEY, JSON.stringify({ serverUrl, username: user, password: pass, user: info }));
    } catch {
      // storage full or blocked: the session lasts until reload
    }
  }

  clearSession() {
    this.user = null;
    this.serverUrl = '';
    this.username = '';
    this.password = '';
    this.coverCache.clear();
    this.listCache.clear();
    try {
      localStorage.removeItem(CREDS_KEY);
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent(EVENTS.authChanged));
  }

  private base(action?: string): string {
    const q = `${this.serverUrl}/player_api.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
    return action ? `${q}&action=${action}` : q;
  }

  async authenticate(serverUrl?: string, user?: string, pass?: string): Promise<XtreamUser> {
    let sUrl = (serverUrl || this.serverUrl).trim().replace(/\/+$/, '');
    if (sUrl && !/^https?:\/\//i.test(sUrl)) sUrl = 'http://' + sUrl;
    const u = user ?? this.username;
    const p = pass ?? this.password;
    const url = `${sUrl}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    let data: any;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('Sunucu yanıt vermedi (zaman aşımı).');
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!data || !data.user_info || data.user_info.auth === 0) {
      throw new Error('Giriş başarısız. Bilgilerinizi kontrol edin.');
    }
    const info = data.user_info;
    let exp = 'Süresiz';
    const expSec = Number(info.exp_date);
    if (info.exp_date && !isNaN(expSec) && expSec > 0) {
      exp = new Date(expSec * 1000).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    const userObj: XtreamUser = {
      username: info.username || u,
      status: info.status || 'Aktif',
      exp_date: exp,
      active_cons: Number(info.active_cons || 0),
      max_connections: Number(info.max_connections || 1),
      server_url: sUrl,
    };
    this.saveSession(sUrl, u, p, userObj);
    return userObj;
  }

  /** GET a list endpoint once: cached for a while, concurrent callers share the request. */
  private fetchList(url: string, post?: (list: any[]) => any[]): Promise<any[]> {
    const hit = this.listCache.get(url);
    if (hit && Date.now() - hit.at < LIST_TTL) return Promise.resolve(hit.data);
    const pending = this.inflight.get(url);
    if (pending) return pending;
    const task = (async () => {
      try {
        const res = await fetch(url);
        const text = res.ok ? await res.text() : '[]';
        const parsed = JSON.parse(text);
        let list: any[] = Array.isArray(parsed) ? parsed : [];
        if (post) list = post(list);
        if (list.length) this.listCache.set(url, { at: Date.now(), data: list, text, post });
        return list;
      } catch {
        return [];
      } finally {
        this.inflight.delete(url);
      }
    })();
    this.inflight.set(url, task);
    return task;
  }

  // ---- background refresh ------------------------------------------------

  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;
  private lastRefresh = Date.now();
  private isBusy: () => boolean = () => false;

  /** isBusy returns true while fullscreen playback runs; refreshing then waits. */
  startAutoRefresh(isBusy: () => boolean) {
    this.isBusy = isBusy;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => this.refreshContent(), REFRESH_EVERY);
  }

  /** Catch up after playback if the periodic refresh was skipped meanwhile. */
  refreshIfStale() {
    if (Date.now() - this.lastRefresh >= REFRESH_EVERY) this.refreshContent();
  }

  /**
   * Re-fetches every cached list. A list is only re-parsed when its raw text
   * changed; requests are spaced 200 ms apart and stop if playback starts.
   */
  async refreshContent(): Promise<void> {
    if (this.refreshing || !this.isLoggedIn || this.isBusy()) return;
    this.refreshing = true;
    const changed = new Set<string>();
    let completed = true;
    try {
      for (const [url, entry] of [...this.listCache]) {
        if (this.isBusy() || !this.isLoggedIn) {
          completed = false;
          break;
        }
        try {
          const res = await fetch(url);
          if (res.ok) {
            const text = await res.text();
            if (text === entry.text) {
              entry.at = Date.now();
            } else {
              const parsed = JSON.parse(text);
              if (Array.isArray(parsed)) {
                const list = entry.post ? entry.post(parsed) : parsed;
                this.listCache.set(url, { at: Date.now(), data: list, text, post: entry.post });
                changed.add(url.includes('get_live') ? 'live' : url.includes('get_vod') ? 'vod' : 'series');
              }
            }
          }
        } catch {
          // keep the old data while the server is unreachable
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (completed) this.lastRefresh = Date.now();
    } finally {
      this.refreshing = false;
    }
    if (changed.size) window.dispatchEvent(new CustomEvent(EVENTS.contentUpdated, { detail: { kinds: [...changed] } }));
  }

  // ---- endpoints ---------------------------------------------------------

  getLiveCategories(): Promise<Category[]> {
    return this.fetchList(this.base('get_live_categories'));
  }

  getLiveStreams(categoryId?: string): Promise<any[]> {
    let url = this.base('get_live_streams');
    if (categoryId && categoryId !== 'all') url += `&category_id=${encodeURIComponent(categoryId)}`;
    return this.fetchList(url, (list) => list.map((ch) => ({ ...ch, stream_url: this.liveUrl(ch.stream_id) })));
  }

  getVodCategories(): Promise<Category[]> {
    return this.fetchList(this.base('get_vod_categories'));
  }

  getVodStreams(categoryId?: string): Promise<any[]> {
    let url = this.base('get_vod_streams');
    if (categoryId && categoryId !== 'all') url += `&category_id=${encodeURIComponent(categoryId)}`;
    return this.fetchList(url, (list) =>
      list.map((m) => ({ ...m, stream_url: `${this.serverUrl}/movie/${this.username}/${this.password}/${m.stream_id}.${m.container_extension || 'mp4'}` })),
    );
  }

  getSeriesCategories(): Promise<Category[]> {
    return this.fetchList(this.base('get_series_categories'));
  }

  getSeriesList(categoryId?: string): Promise<any[]> {
    let url = this.base('get_series');
    if (categoryId && categoryId !== 'all') url += `&category_id=${encodeURIComponent(categoryId)}`;
    return this.fetchList(url, (list) => {
      for (const s of list) {
        if (s.series_id && s.cover) {
          s.cover = this.normalizeImageUrl(s.cover);
          this.setCachedCover(s.series_id, s.cover);
        }
      }
      return list;
    });
  }

  async getSeriesInfo(seriesId: string | number): Promise<any> {
    try {
      const res = await fetch(`${this.base('get_series_info')}&series_id=${encodeURIComponent(String(seriesId))}`);
      const data = res.ok ? await res.json() : null;
      if (data?.info?.cover) {
        data.info.cover = this.normalizeImageUrl(data.info.cover);
        this.setCachedCover(seriesId, data.info.cover);
      }
      return data;
    } catch {
      return null;
    }
  }

  liveUrl(streamId: string | number, ext = 'm3u8'): string {
    return `${this.serverUrl}/live/${this.username}/${this.password}/${streamId}.${ext}`;
  }

  getEpisodeStreamUrl(streamId: string | number, containerExtension = 'mp4'): string {
    const ext = containerExtension.replace('.', '') || 'mp4';
    return `${this.serverUrl}/series/${this.username}/${this.password}/${streamId}.${ext}`;
  }
}

export const api = new ApiService();
