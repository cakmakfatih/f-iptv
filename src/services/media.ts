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

/** Range-requests the first bytes: HLS if the server says mpegurl or the body starts with #EXTM3U. */
async function probeIsHls(url: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    let res = await fetch(url, { headers: { Range: 'bytes=0-512' }, signal: ctrl.signal });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (!type.includes('mpegurl') && /^(video|audio)\//.test(type)) {
      await res.body?.cancel();
      return { hls: false };
    }
    let text = await readTrackResponse(res);
    const hls = type.includes('mpegurl') || text.trimStart().startsWith('#EXTM3U');
    if (hls && res.status === 206) {
      res = await fetch(url, { signal: ctrl.signal });
      text = await readTrackResponse(res);
    }
    return { hls, tracks: hls ? hlsRenditions(text, res.url || url) : undefined };
  } catch {
    return null; // CORS or timeout: decide from the extension
  } finally {
    clearTimeout(timer);
  }
}

/** A VOD/episode source whose primary type comes from the probe, with the other type as fallback. */
export async function vodSource(url: string, base: Omit<VideoSource, 'url'>): Promise<VideoSource> {
  const probed = await probeIsHls(url);
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
