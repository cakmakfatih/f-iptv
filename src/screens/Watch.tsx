import { h, Button, toast, useEffect, useMemo, useRef, useSignalValue, useState, type RouteProps } from 'zapkit-tv';
import { Player, PlayerState, VideoPlayer, type PlayerStrings, type VideoSource } from 'zapkit-tv/player';
import { api, EVENTS } from '../services/api';
import { history } from '../services/history';
import { liveSource, playback, seriesPlaylist, vodSource, type EpisodeMeta, type LiveChannel } from '../services/media';
import { Clock, useWindowEvent } from '../components/ui';
import { GoLiveButton, NextEpisodeButton, PlaylistPosition, PreviousEpisodeButton, UpNextCard } from '../components/player-parts';
import { t, type Key } from '../i18n';

export type WatchState =
  | { kind: 'live'; channels: LiveChannel[]; index: number }
  | { kind: 'vod'; movie: any; startTime?: number }
  | { kind: 'series'; seriesId: string; seriesName: string; episodeId: string; cover: string; startTime?: number; info?: any };

/** Every word the SDK player shows, in the current language (channels say "channel" instead of "item"). */
const PLAYER_KEYS = [
  'play', 'pause', 'previous', 'next', 'rewind', 'forward', 'captions', 'audio', 'settings', 'stats', 'quality', 'auto', 'speed',
  'normal', 'off', 'captionStyle', 'fontSize', 'textColor', 'background', 'live', 'edge', 'edgeNone', 'edgeOutline', 'edgeDropShadow',
  'edgeRaised', 'edgeDepressed', 'white', 'yellow', 'cyan', 'green', 'statsEngine', 'statsVideoId', 'statsFrames', 'statsFramesValue', 'statsResolution',
  'statsVolume', 'statsCodecs', 'statsConnection', 'statsBitrate', 'statsBuffer', 'statsLatency', 'statsSpeed', 'statsState', 'retry',
  'errorTitle', 'back',
] as const;

function playerStrings(kind: string): Partial<PlayerStrings> {
  const s: Partial<PlayerStrings> = {};
  for (const k of PLAYER_KEYS) s[k] = t(('player.' + k) as Key);
  if (kind === 'live') {
    s.previous = t('player.prevChannel');
    s.next = t('player.nextChannel');
  }
  return s;
}

const ASPECTS: Array<{ fit: string; label: Key }> = [
  { fit: 'contain', label: 'watch.aspect.fit' },
  { fit: 'cover', label: 'watch.aspect.fill' },
  { fit: 'fill', label: 'watch.aspect.stretch' },
];

const SAVE_EVERY = 10000;

/** Progress record for a VOD or episode source; live sources are not saved. */
function progressFor(src: VideoSource, pos: number, d: number) {
  const meta = (src.metadata || {}) as Record<string, any>;
  if (meta.kind === 'series') {
    const ep = meta as unknown as EpisodeMeta;
    return {
      contentId: history.makeContentId('series', ep.seriesId, ep.episodeId),
      streamType: 'series' as const,
      title: ep.seriesName,
      subtitle: src.subtitle || '',
      streamUrl: src.url,
      cover: ep.cover,
      seriesId: ep.seriesId,
      seriesName: ep.seriesName,
      episodeId: ep.episodeId,
      seasonNum: ep.seasonNum,
      episodeNum: ep.episodeNum,
      currentTime: pos,
      duration: d,
    };
  }
  if (meta.kind === 'vod') {
    return {
      contentId: history.makeContentId('vod', meta.streamId),
      streamType: 'vod' as const,
      title: src.title || t('common.movie'),
      subtitle: '',
      streamUrl: src.url,
      cover: src.poster,
      currentTime: pos,
      duration: d,
    };
  }
  return null;
}

export function Watch({ router, state }: RouteProps) {
  const ws = state as WatchState | undefined;
  const player = useMemo(
    () => new Player({ autoAdvance: !!ws && ws.kind === 'series', autoAdvanceDelay: 10, upNextLead: 20, persistPrefs: true }),
    [],
  );
  const [aspect, setAspect] = useState(0);
  const [loading, setLoading] = useState(true);
  // Once a source is set the player shows its own buffering spinner.
  const source = useSignalValue(player.source);
  const last = useRef<{ src: VideoSource | null; t: number; d: number }>({ src: null, t: 0, d: 0 });
  const lastSaved = useRef(0);

  const save = () => {
    const { src, t, d } = last.current;
    if (!src) return;
    const rec = progressFor(src, t, d);
    if (rec) history.saveProgress(rec);
    lastSaved.current = Date.now();
  };

  const start = async () => {
    if (!ws) return router.back();
    setLoading(true);
    try {
      if (ws.kind === 'live') {
        await player.loadPlaylist(ws.channels.map(liveSource), ws.index);
      } else if (ws.kind === 'vod') {
        const m = ws.movie;
        const streamId = String(m.stream_id);
        const saved = history.getProgress(history.makeContentId('vod', streamId));
        const src = await vodSource(m.stream_url, {
          id: 'vod_' + streamId,
          title: m.name || m.title || t('common.movie'),
          subtitle: '',
          poster: api.normalizeImageUrl(m.stream_icon) || undefined,
          metadata: { kind: 'vod', streamId },
        });
        await player.load(src, ws.startTime ?? (saved ? saved.currentTime : 0));
      } else {
        const info = ws.info || (await api.getSeriesInfo(ws.seriesId));
        const cover = ws.cover || (info && info.info && info.info.cover) || api.getCachedCover(ws.seriesId);
        const list = seriesPlaylist(ws.seriesId, ws.seriesName, info, cover);
        if (!list.length) {
          toast(t('watch.noEpisodes'), { kind: 'error' });
          return router.back();
        }
        const idx = Math.max(0, list.findIndex((s) => (s.metadata as any).episodeId === String(ws.episodeId)));
        // Probe only the first episode; later ones keep their fallback.
        list[idx] = await vodSource(list[idx].url, { ...list[idx] });
        await player.loadPlaylist(list, idx, ws.startTime ?? list[idx].startTime);
      }
      await player.play().catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    playback.active = true;
    start();

    const offs = [
      player.on('onVideoDataChange', (src) => {
        // Episode changed (next / auto-advance): keep the previous one's position.
        const prev = last.current.src;
        if (prev && src && prev.id !== src.id) save();
        last.current = { src, t: src && src.startTime ? src.startTime : 0, d: 0 };
      }),
      player.on('onStateChange', (s) => {
        if (s === PlayerState.PAUSED) save();
        if (s === PlayerState.ENDED) {
          const src = player.source.peek();
          const meta = (src && src.metadata) || {};
          if ((meta as any).kind === 'series' && !player.hasNext()) toast(t('watch.lastEpisode'), { kind: 'info' });
        }
      }),
      player.on('onSeek', () => save()),
    ];

    const timer = setInterval(() => {
      const src = player.source.peek();
      if (!src || src.live) return;
      const t = player.currentTime.peek();
      const d = player.duration.peek();
      if (t > 0) last.current = { src, t, d };
      if (player.state.peek() === PlayerState.PLAYING && Date.now() - lastSaved.current >= SAVE_EVERY) save();
    }, 1000);

    return () => {
      clearInterval(timer);
      offs.forEach((off) => off());
      save();
      player.destroy();
      playback.active = false;
      setTimeout(() => api.refreshIfStale(), 2500);
    };
  }, []);

  // The server dropped what is playing (background refresh): leave the player.
  useWindowEvent(EVENTS.contentUpdated, async (e) => {
    if (!ws) return;
    const kinds: string[] = (e as CustomEvent).detail?.kinds || [];
    const src = player.source.peek();
    const meta = ((src && src.metadata) || {}) as Record<string, any>;
    let gone = false;
    if (ws.kind === 'live' && kinds.includes('live')) {
      const list = await api.getLiveStreams();
      gone = !list.some((c: any) => String(c.stream_id) === meta.streamId);
    } else if (ws.kind === 'vod' && kinds.includes('vod')) {
      const list = await api.getVodStreams();
      gone = !list.some((m: any) => String(m.stream_id) === meta.streamId);
    } else if (ws.kind === 'series' && kinds.includes('series')) {
      const info = await api.getSeriesInfo(ws.seriesId);
      const eps = info && info.episodes ? Object.values(info.episodes).flat() : [];
      gone = !!info && !eps.some((ep: any) => String(ep.id) === meta.episodeId);
    }
    if (gone) {
      toast(t('watch.gone'), { kind: 'error' });
      setTimeout(() => router.back(), 1800);
    }
  });

  const cycleAspect = () => {
    const next = (aspect + 1) % ASPECTS.length;
    player.video.style.objectFit = ASPECTS[next].fit;
    setAspect(next);
  };

  const kind = ws ? ws.kind : 'vod';
  return (
    <div className={['screen-watch', 'screen-watch--' + kind]}>
      <VideoPlayer
        player={player}
        strings={playerStrings(kind)}
        // Series have their own labelled "Previous episode" and "Next episode" buttons, so the built-in ones are left out.
        controls={kind === 'series' ? { previous: false, next: false } : undefined}
        showStats
        onBack={() => router.back()}
        metadata={
          <div className="osd-meta">
            {kind === 'live' ? <span className="osd-meta__tag osd-meta__tag--live">{t('watch.tag.live')}</span> : null}
            {kind === 'series' ? <span className="osd-meta__tag">{t('watch.tag.series')}</span> : null}
            {kind === 'vod' ? <span className="osd-meta__tag">{t('watch.tag.movie')}</span> : null}
            {kind !== 'vod' ? <PlaylistPosition player={player} /> : null}
            <Clock />
          </div>
        }
        extraControls={[
          kind === 'series' ? <PreviousEpisodeButton key="prev" player={player} /> : null,
          kind === 'series' ? <NextEpisodeButton key="next" player={player} /> : null,
          kind === 'live' ? <GoLiveButton key="golive" player={player} /> : null,
          <Button key="aspect" icon="aspect" label={t(ASPECTS[aspect].label)} className="osd-aspect" focusId="watch-aspect" onClick={cycleAspect} />,
          <Button key="close" icon="close" label={t('common.close')} className="osd-close" focusId="watch-close" onClick={() => router.back()} />,
        ]}
      >
        {kind === 'series' ? <UpNextCard player={player} /> : null}
      </VideoPlayer>
      {loading && !source ? (
        <div className="watch-loading">
          <div className="kb-spinner" />
          <span>{kind === 'live' ? t('watch.openingStream') : t('watch.preparing')}</span>
        </div>
      ) : null}
    </div>
  );
}
