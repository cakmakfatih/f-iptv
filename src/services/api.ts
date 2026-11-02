/**
 * Xtream Codes API client: login, categories, live/VOD/series lists, series
 * info and stream URLs. Lists are cached (shared in-flight requests, 12 min
 * TTL) and refreshed in the background every 10 minutes; views are told what
 * changed through the `app:content-updated` window event.
 */
import { t } from '../i18n';

export interface XtreamUser {
  username: string;
  status: string;
  /** Expiry as epoch seconds ("" = no expiry). Older saved profiles hold an already formatted text. */
  exp_date: string;
  active_cons: number;
  max_connections: number;
  server_url: string;
}

/** A saved login (Netflix-style "who is watching"); its id is the account key that scopes watch history. */
export interface Profile {
  id: string;
  /** Name shown in the picker; unique among profiles ("Profile 1" when not chosen). */
  name: string;
  serverUrl: string;
  username: string;
  password: string;
  user: XtreamUser | null;
  addedAt: number;
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
const PROFILES_KEY = 'profiles_key';
/** The server answered but rejected the credentials (as opposed to being unreachable). */
export class LoginRejected extends Error {}

/** Saved logins the picker holds at most. */
export const MAX_PROFILES = 4;
export const profileLimitMessage = () => t('profile.limit', { n: MAX_PROFILES });
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
  private profiles: Profile[] = [];

  constructor() {
    this.loadProfiles();
  }

  get isLoggedIn(): boolean {
    return !!(this.serverUrl && this.username);
  }

  /** Stable per-account key (host_port_user) used to scope watch history. */
  getAccountKey(): string {
    return this.accountKeyOf(this.serverUrl, this.username);
  }

  private accountKeyOf(serverUrl: string, username: string): string {
    const s = serverUrl.trim().toLowerCase();
    const u = username.trim().toLowerCase();
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

  // ---- profiles ----------------------------------------------------------

  /** Saved logins. The app always opens on the profile picker; nothing is signed in until one is selected. */
  private loadProfiles() {
    try {
      const saved = localStorage.getItem(PROFILES_KEY);
      if (saved) {
        const list = JSON.parse(saved);
        if (Array.isArray(list)) this.profiles = list.filter((p) => p && p.id && p.serverUrl && p.username);
        this.ensureNames();
        return;
      }
      // Older versions kept one login in creds_key: it becomes the first profile.
      const old = localStorage.getItem(CREDS_KEY);
      if (old) {
        const p = JSON.parse(old);
        if (p.serverUrl && p.username) {
          this.profiles = [
            { id: this.accountKeyOf(p.serverUrl, p.username), name: t('profile.autoName', { n: 1 }), serverUrl: p.serverUrl, username: p.username, password: p.password || '', user: p.user || null, addedAt: Date.now() },
          ];
          this.persistProfiles();
        }
        localStorage.removeItem(CREDS_KEY);
      }
    } catch {
      // corrupt data: start without profiles
    }
  }

  /** Smallest "Profile N" ("Oturum N" in Turkish) that no profile uses yet, in either language. */
  private autoName(): string {
    const used = new Set(this.profiles.map((p) => (p.name || '').toLowerCase()));
    let n = 1;
    while (used.has(`profile ${n}`) || used.has(`oturum ${n}`)) n++;
    return t('profile.autoName', { n });
  }

  /** Profiles saved before names existed get one. */
  private ensureNames() {
    let changed = false;
    for (const p of this.profiles) {
      if (p.name) continue;
      p.name = this.autoName();
      changed = true;
    }
    if (changed) this.persistProfiles();
  }

  /** True when another profile (not `exceptId`) already has this name (case-insensitive). */
  isNameTaken(name: string, exceptId?: string): boolean {
    const n = name.trim().toLowerCase();
    return !!n && this.profiles.some((p) => p.id !== exceptId && p.name.toLowerCase() === n);
  }

  private persistProfiles() {
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(this.profiles));
    } catch {
      // storage full or blocked: profiles last until reload
    }
  }

  listProfiles(): Profile[] {
    return this.profiles.slice();
  }

  /** Signs in with a saved profile (no network); callers re-check the login in the background. */
  selectProfile(id: string): boolean {
    const p = this.profiles.find((x) => x.id === id);
    if (!p) return false;
    this.serverUrl = p.serverUrl;
    this.username = p.username;
    this.password = p.password;
    this.user = p.user;
    this.coverCache.clear();
    this.listCache.clear();
    return true;
  }

  /** Removes a saved login. Its local watch history is removed by the caller (history.clearAccount). */
  removeProfile(id: string) {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    this.persistProfiles();
  }

  private saveSession(serverUrl: string, user: string, pass: string, info: XtreamUser, name?: string) {
    this.serverUrl = serverUrl;
    this.username = user;
    this.password = pass;
    this.user = info;
    this.coverCache.clear();
    this.listCache.clear();
    // Same server + user is the same profile: update it instead of adding another.
    const id = this.getAccountKey();
    const prev = this.profiles.find((p) => p.id === id);
    // A chosen name wins; otherwise the profile keeps its name, or gets the next free "Profile N" (or "Oturum N").
    const profile: Profile = { id, name: (name || '').trim() || (prev ? prev.name : this.autoName()), serverUrl, username: user, password: pass, user: info, addedAt: prev ? prev.addedAt : Date.now() };
    this.profiles = prev ? this.profiles.map((p) => (p.id === id ? profile : p)) : [...this.profiles, profile];
    this.persistProfiles();
  }

  /** Leaves the current profile (it stays saved) and tells the app to show the picker. */
  signOut() {
    this.user = null;
    this.serverUrl = '';
    this.username = '';
    this.password = '';
    this.coverCache.clear();
    this.listCache.clear();
    window.dispatchEvent(new CustomEvent(EVENTS.authChanged));
  }

  private base(action?: string): string {
    const q = `${this.serverUrl}/player_api.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
    return action ? `${q}&action=${action}` : q;
  }

  /** The id a login for this server + user is saved under (same as the account key). */
  profileIdFor(serverUrl: string, user: string): string {
    return this.accountKeyOf(this.normalizeServerUrl(serverUrl), user);
  }

  private normalizeServerUrl(serverUrl: string): string {
    const s = serverUrl.trim().replace(/\/+$/, '');
    return s && !/^https?:\/\//i.test(s) ? 'http://' + s : s;
  }

  /** Name of the profile that is signed in ("" when none). */
  get profileName(): string {
    const p = this.profiles.find((x) => x.id === this.getAccountKey());
    return p ? p.name : '';
  }

  getProfile(id: string): Profile | undefined {
    return this.profiles.find((p) => p.id === id);
  }

  /**
   * Edits a saved login from the picker (nothing is signed in). The name can change on its own; when the
   * server, user or password change, the new login is checked first and nothing is saved if it fails.
   * The caller removes the old account's history when `connectionChanged` (history.clearAccount(oldId)).
   */
  async updateProfile(id: string, edit: { name: string; serverUrl: string; username: string; password: string }): Promise<{ id: string; connectionChanged: boolean }> {
    const prev = this.profiles.find((p) => p.id === id);
    if (!prev) throw new Error(t('error.profileNotFound'));
    const sUrl = this.normalizeServerUrl(edit.serverUrl);
    const u = edit.username.trim();
    const connectionChanged = this.connectionChanged(prev, edit);
    // An emptied name keeps the current one.
    const name = edit.name.trim() || prev.name;
    if (this.isNameTaken(name, id)) throw new Error(t('error.nameTaken'));
    let next: Profile = { ...prev, name };
    if (connectionChanged) {
      const info = await this.checkLogin(sUrl, u, edit.password);
      const newId = this.accountKeyOf(sUrl, u);
      if (newId !== id && this.profiles.some((p) => p.id === newId)) throw new Error(t('error.profileExists'));
      next = { id: newId, name, serverUrl: sUrl, username: u, password: edit.password, user: info, addedAt: prev.addedAt };
    }
    this.profiles = this.profiles.map((p) => (p.id === id ? next : p));
    this.persistProfiles();
    return { id: next.id, connectionChanged };
  }

  /** True when the server, user or password differ from the saved profile. */
  connectionChanged(prev: Profile, edit: { serverUrl: string; username: string; password: string }): boolean {
    return this.normalizeServerUrl(edit.serverUrl) !== prev.serverUrl || edit.username.trim() !== prev.username || edit.password !== prev.password;
  }

  /** Asks the server whether this login works; changes nothing here. */
  private async checkLogin(sUrl: string, u: string, p: string): Promise<XtreamUser> {
    const url =`${sUrl}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    let data: any;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(t('error.http', { status: res.status }));
      data = await res.json();
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') throw new Error(t('error.timeout'));
      // fetch rejects with a TypeError both when the host cannot be reached and when the browser blocks the answer
      // (no CORS headers). A no-cors request tells the two apart: it only fails if the host is truly unreachable.
      if (err instanceof TypeError) {
        const probe = new AbortController();
        const probeTimer = setTimeout(() => probe.abort(), 6000);
        const reachable = await fetch(url, { mode: 'no-cors', signal: probe.signal }).then(
          () => true,
          () => false,
        );
        clearTimeout(probeTimer);
        throw new Error(
          reachable
            ? t('error.blocked')
            : t('error.unreachable', { url: sUrl }),
        );
      }
      if (err instanceof SyntaxError) throw new Error(t('error.notXtream'));
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!data || !data.user_info || data.user_info.auth === 0) {
      throw new LoginRejected(t('error.loginFailed'));
    }
    const info = data.user_info;
    const expSec = Number(info.exp_date);
    const exp = info.exp_date && !isNaN(expSec) && expSec > 0 ? String(expSec) : '';
    const userObj: XtreamUser = {
      username: info.username || u,
      status: info.status || '',
      exp_date: exp,
      active_cons: Number(info.active_cons || 0),
      max_connections: Number(info.max_connections || 1),
      server_url: sUrl,
    };
    return userObj;
  }

  async authenticate(serverUrl?: string, user?: string, pass?: string, name?: string): Promise<XtreamUser> {
    const sUrl = this.normalizeServerUrl(serverUrl || this.serverUrl);
    const u = user ?? this.username;
    const p = pass ?? this.password;
    // A new login needs a free slot; signing in again with a saved one only updates it.
    if (serverUrl !== undefined && this.profiles.length >= MAX_PROFILES && !this.profiles.some((x) => x.id === this.accountKeyOf(sUrl, u))) {
      throw new Error(profileLimitMessage());
    }
    const userObj = await this.checkLogin(sUrl, u, p);
    if (name && this.isNameTaken(name, this.accountKeyOf(sUrl, u))) throw new Error(t('error.nameTaken'));
    this.saveSession(sUrl, u, p, userObj, name);
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
