/**
 * Builds player sources from Xtream items.
 *
 * Xtream servers often hand out ".mp4"/".mkv" VOD links that actually answer
 * with an HLS playlist (and vice versa), so VOD URLs are probed first and the
 * other format is always attached as a fallback.
 */
import type { VideoSource } from 'zapkit-tv/player';
import { api } from './api';
import { formatEpisodeTitle } from './format';
import { t } from '../i18n';
import { history } from './history';
import { hlsRenditions, readTrackResponse } from './player-tracks';

/** True while the fullscreen player runs; background refreshes wait meanwhile. */
export const playback = { active: false };

/** Inspect headers before fetching an HLS manifest without starting a media transfer. */
async function probeIsHls(url: string, signal?: AbortSignal) {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) ctrl.abort();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    let res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const hls = type.includes('mpegurl') || /\.m3u8?(\?|$)/i.test(url);
    if (!hls) return /^(video|audio)\//.test(type) ? { hls: false } : null;
    res = await fetch(url, { signal: ctrl.signal });
    const text = await readTrackResponse(res);
    return { hls, tracks: hls ? hlsRenditions(text, res.url || url) : undefined };
  } catch {
    return null; // CORS or timeout: decide from the extension
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** A VOD/episode source whose primary type comes from the probe, with the other type as fallback. */
export async function vodSource(url: string, base: Omit<VideoSource, 'url'>, signal?: AbortSignal): Promise<VideoSource> {
  const probed = await probeIsHls(url, signal);
  const hls = probed?.hls ?? /\.m3u8(\?|$)/i.test(url);
  return {
    ...base,
    url,
    type: hls ? 'hls' : 'progressive',
    metadata: { ...base.metadata, hlsTracks: probed?.tracks, tracksProbed: true },
    fallbacks: [{ url, type: hls ? 'progressive' : 'hls' }],
  };
}

export interface LiveChannel {
  stream_id: number | string;
  name: string;
  num?: number | string;
  stream_icon?: string;
  epg_title?: string;
  category_id?: number | string;
  stream_url: string;
}

export function liveSource(ch: LiveChannel): VideoSource {
  return {
    id: 'live_' + ch.stream_id,
    url: ch.stream_url,
    type: 'hls',
    live: true,
    title: ch.name || t('live.unknownChannel'),
    subtitle: t('media.liveSubtitle', { n: ch.num || '1' }),
    poster: ch.stream_icon || undefined,
    metadata: { kind: 'live', streamId: String(ch.stream_id) },
    fallbacks: [{ url: api.liveUrl(ch.stream_id, 'ts'), type: 'progressive' }],
  };
}

export interface EpisodeMeta {
  kind: 'series';
  seriesId: string;
  seriesName: string;
  episodeId: string;
  seasonNum: number;
  episodeNum: number;
  cover: string;
}

/**
 * Every episode of every season (seasons in numeric order) as a playlist, each
 * starting where it was left. Used for "Next episode" and Up Next.
 */
export function seriesPlaylist(seriesId: string, seriesName: string, info: any, cover: string): VideoSource[] {
  const episodes = info?.episodes || {};
  const seasons = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
  const list: VideoSource[] = [];
  for (const s of seasons) {
    for (const ep of episodes[s] || []) {
      const epNum = Number(ep.episode_num) || 1;
      const url = api.getEpisodeStreamUrl(ep.id, ep.container_extension || 'mp4');
      const saved = history.getEpisodeProgress(seriesId, ep.id) || history.getEpisodeProgress(seriesId, epNum);
      const meta: EpisodeMeta = {
        kind: 'series',
        seriesId: String(seriesId),
        seriesName,
        episodeId: String(ep.id),
        seasonNum: Number(s),
        episodeNum: epNum,
        cover,
      };
      list.push({
        id: `series_${seriesId}_ep_${ep.id}`,
        url,
        type: /\.m3u8$/i.test(url) ? 'hls' : 'progressive',
        fallbacks: [{ url, type: /\.m3u8$/i.test(url) ? 'progressive' : 'hls' }],
        title: seriesName,
        subtitle: t('media.episodeSubtitle', { s, title: formatEpisodeTitle(ep.title, epNum) }),
        poster: ep.info?.movie_image ? api.normalizeImageUrl(ep.info.movie_image) : cover,
        startTime: saved ? saved.currentTime : 0,
        metadata: meta as unknown as Record<string, unknown>,
      });
    }
  }
  return list;
}
