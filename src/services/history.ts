/**
 * Watch progress ("Kaldığın yerden devam et"), stored per account in
 * localStorage. Items from another server or user are purged on read, and
 * episode stream URLs are rebuilt for the current account.
 */
import { api, EVENTS } from './api';

export interface WatchProgressItem {
  contentId: string;
  streamType: 'vod' | 'series';
  title: string;
  subtitle: string;
  streamUrl: string;
  cover?: string;
  seriesId?: number | string;
  seriesName?: string;
  episodeId?: string | number;
  seasonNum?: number;
  episodeNum?: number;
  currentTime: number;
  duration: number;
  progressPercent: number;
  updatedAt: number;
  accountKey?: string;
  serverUrl?: string;
  username?: string;
}

export type ProgressInput = Omit<WatchProgressItem, 'progressPercent' | 'updatedAt' | 'accountKey' | 'serverUrl' | 'username'>;

const KEY_PREFIX = 'watch_progress';
const MAX_ITEMS = 40;

let cache: { raw: string; sig: string; items: WatchProgressItem[] } | null = null;

function storageKey(): string {
  return `${KEY_PREFIX}_${api.getAccountKey()}`;
}

function notify() {
  window.dispatchEvent(new CustomEvent(EVENTS.historyUpdated));
}

function write(items: WatchProgressItem[]) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(items));
    notify();
  } catch {
    // ignore
  }
}

function extractHost(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url.startsWith('http') ? url : `http://${url}`).host.toLowerCase();
  } catch {
    const m = url.match(/https?:\/\/([^/:]+(?::\d+)?)/i);
    return m ? m[1].toLowerCase() : '';
  }
}

function extractUserFromUrl(url?: string): string {
  const m = url ? url.match(/\/(?:series|movie|live)\/([^/]+)\//i) : null;
  return m ? m[1].toLowerCase().trim() : '';
}

function getAll(): WatchProgressItem[] {
  try {
    const currentHost = extractHost(api.serverUrl);
    const currentUser = api.username.toLowerCase().trim();
    const currentKey = api.getAccountKey();
    if (!currentHost || currentKey === 'guest') return [];
    const key = storageKey();
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const sig = `${currentKey}|${api.serverUrl}|${api.username}`;
    if (cache && cache.raw === raw && cache.sig === sig) return cache.items.slice();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    let discarded = false;
    const valid: WatchProgressItem[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        discarded = true;
        continue;
      }
      if (item.accountKey && item.accountKey !== currentKey) {
        discarded = true;
        continue;
      }
      const itemHost = extractHost(item.serverUrl || item.streamUrl);
      if (itemHost && itemHost !== currentHost) {
        discarded = true;
        continue;
      }
      const itemUser = String(item.username || extractUserFromUrl(item.streamUrl)).toLowerCase().trim();
      if (currentUser && itemUser && itemUser !== currentUser) {
        discarded = true;
        continue;
      }
      let streamUrl = item.streamUrl;
      if (item.streamType === 'series' && item.episodeId) {
        const ext = (streamUrl && streamUrl.split('.').pop()) || 'mp4';
        streamUrl = api.getEpisodeStreamUrl(item.episodeId, ext);
      }
      valid.push({
        ...item,
        accountKey: currentKey,
        serverUrl: api.serverUrl,
        username: api.username,
        streamUrl,
        cover: item.cover ? api.normalizeImageUrl(item.cover) : '',
      });
    }
    if (discarded) {
      try {
        localStorage.setItem(key, JSON.stringify(valid));
      } catch {
        // ignore
      }
    }
    cache = { raw: discarded ? JSON.stringify(valid) : raw, sig, items: valid };
    return valid.slice();
  } catch {
    return [];
  }
}

export const history = {
  makeContentId(streamType: 'vod' | 'series', id: string | number, epId?: string | number): string {
    return streamType === 'series' && epId != null ? `series_${id}_ep_${epId}` : `vod_${id}`;
  },

  /**
   * Saves a position. Under 3 s is ignored; at 95 % or more the item counts as
   * finished and is removed so it starts over next time.
   */
  saveProgress(item: ProgressInput): void {
    const cur = Math.floor(item.currentTime || 0);
    if (cur < 3) return;
    let dur = Math.floor(item.duration || 0);
    if (dur <= 0 || !isFinite(dur)) {
      const prev = history.getProgress(item.contentId);
      dur = prev?.duration && prev.duration > 0 ? prev.duration : Math.max(cur + 60, 2400);
    }
    const pct = Math.min(100, Math.max(1, Math.round((cur / dur) * 100)));
    if (pct >= 95) {
      history.clearProgress(item.contentId);
      return;
    }
    const record: WatchProgressItem = {
      ...item,
      accountKey: api.getAccountKey(),
      serverUrl: api.serverUrl,
      username: api.username,
      cover: api.normalizeImageUrl(item.cover || ''),
      currentTime: cur,
      duration: dur,
      progressPercent: pct,
      updatedAt: Date.now(),
    };
    const list = getAll().filter((x) => x.contentId !== item.contentId);
    list.unshift(record);
    if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
    write(list);
  },

  getProgress(contentId: string): WatchProgressItem | null {
    return getAll().find((x) => x.contentId === contentId) || null;
  },

  getEpisodeProgress(seriesId: number | string, epId: string | number): WatchProgressItem | null {
    return history.getProgress(history.makeContentId('series', seriesId, epId));
  },

  /** One entry per series: its most recently watched episode, newest first. */
  getSeriesContinueList(): WatchProgressItem[] {
    const all = getAll().filter((x) => x.streamType === 'series' && x.seriesId != null);
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    const seen = new Set<string>();
    return all.filter((x) => {
      const sid = String(x.seriesId);
      if (seen.has(sid)) return false;
      seen.add(sid);
      return true;
    });
  },

  getRecentList(limit = 10): WatchProgressItem[] {
    return getAll().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  },

  clearProgress(contentId: string): void {
    write(getAll().filter((x) => x.contentId !== contentId));
  },

  clearSeriesHistory(): void {
    write(getAll().filter((x) => x.streamType !== 'series'));
  },

  clearSeriesItem(seriesId: string | number): void {
    write(getAll().filter((x) => String(x.seriesId) !== String(seriesId)));
  },

  clearAll(): void {
    try {
      localStorage.removeItem(storageKey());
      notify();
    } catch {
      // ignore
    }
  },
};
