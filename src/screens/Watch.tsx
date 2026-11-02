import { h, Button, toast, useEffect, useMemo, useRef, useSignalValue, useState, type RouteProps } from 'zapkit-tv';
import { Player, PlayerState, VideoPlayer, type PlayerStrings, type VideoSource } from 'zapkit-tv/player';
import { api, EVENTS } from '../services/api';
import { history } from '../services/history';
import { liveSource, playback, seriesPlaylist, vodSource, type EpisodeMeta, type LiveChannel } from '../services/media';
import { Clock, useWindowEvent } from '../components/ui';

export type WatchState =
  | { kind: 'live'; channels: LiveChannel[]; index: number }
  | { kind: 'vod'; movie: any; startTime?: number }
  | { kind: 'series'; seriesId: string; seriesName: string; episodeId: string; cover: string; startTime?: number; info?: any };

const STRINGS: Partial<PlayerStrings> = {
  play: 'Oynat',
  pause: 'Duraklat',
  previous: 'Önceki',
  next: 'Sonraki',
  rewind: '10 sn Geri',
  forward: '10 sn İleri',
  captions: 'Altyazı',
  audio: 'Ses',
  settings: 'Ayarlar',
  stats: 'Teknik Bilgi',
  quality: 'Kalite',
  auto: 'Otomatik',
  speed: 'Oynatma Hızı',
  normal: 'Normal',
  off: 'Kapalı',
  captionStyle: 'Altyazı Görünümü',
  fontSize: 'Yazı Boyutu',
  textColor: 'Yazı Rengi',
  background: 'Arka Plan',
  live: 'CANLI',
  goLive: 'Canlıya Dön',
  upNext: 'Sıradaki Bölüm',
  playNow: 'Şimdi Oynat',
  cancel: 'Vazgeç',
  startsIn: '{s} sn içinde başlıyor',
  retry: 'Tekrar Dene',
  errorTitle: 'Bu içerik oynatılamıyor',
  back: 'Geri',
};

const ASPECTS: Array<{ fit: string; label: string }> = [
  { fit: 'contain', label: '16:9 Oran' },
  { fit: 'cover', label: 'Tam Ekran' },
  { fit: 'fill', label: 'Uzatılmış' },
];

const SAVE_EVERY = 10000;

/** Progress record for a VOD or episode source; live sources are not saved. */
function progressFor(src: VideoSource, t: number, d: number) {
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
      currentTime: t,
      duration: d,
    };
  }
  if (meta.kind === 'vod') {
    return {
      contentId: history.makeContentId('vod', meta.streamId),
      streamType: 'vod' as const,
      title: src.title || 'Film',
      subtitle: 'Film',
      streamUrl: src.url,
      cover: src.poster,
      currentTime: t,
      duration: d,
    };
  }
  return null;
}

function NextEpisodeButton({ player }: { player: Player }) {
  const index = useSignalValue(player.playlistIndex);
  const list = useSignalValue(player.playlist);
  const next = index >= 0 && index + 1 < list.length ? list[index + 1] : null;
  return (
    <Button
      icon="next"
      label="Sonraki Bölüm"
      className="osd-next"
      focusId="watch-next-episode"
      title={next ? next.subtitle : undefined}
      onClick={() => (next ? player.nextVideo() : toast('Bu dizinin son bölümündesiniz!', { kind: 'info' }))}
    />
  );
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
          title: m.name || m.title || 'Film',
          subtitle: 'Film',
          poster: api.normalizeImageUrl(m.stream_icon) || undefined,
          metadata: { kind: 'vod', streamId },
        });
        await player.load(src, ws.startTime ?? (saved ? saved.currentTime : 0));
      } else {
        const info = ws.info || (await api.getSeriesInfo(ws.seriesId));
        const cover = ws.cover || (info && info.info && info.info.cover) || api.getCachedCover(ws.seriesId);
        const list = seriesPlaylist(ws.seriesId, ws.seriesName, info, cover);
        if (!list.length) {
          toast('Bu dizide oynatılabilir bölüm bulunamadı', { kind: 'error' });
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
          if ((meta as any).kind === 'series' && !player.hasNext()) toast('Bu dizinin son bölümündesiniz!', { kind: 'info' });
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
      toast('Bu içerik artık yayında değil', { kind: 'error' });
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
        strings={STRINGS}
        showStats
        // Channels keep previous/next; episodes use the single "Sonraki Bölüm" button, films have none.
        skipButtons={kind === 'live'}
        onBack={() => router.back()}
        metadata={
          <div className="osd-meta">
            {kind === 'live' ? <span className="osd-meta__tag osd-meta__tag--live">CANLI</span> : null}
            {kind === 'series' ? <span className="osd-meta__tag">DİZİ</span> : null}
            {kind === 'vod' ? <span className="osd-meta__tag">FİLM</span> : null}
            <Clock />
          </div>
        }
        extraControls={[
          kind === 'series' ? <NextEpisodeButton key="next" player={player} /> : null,
          <Button key="aspect" icon="aspect" label={ASPECTS[aspect].label} className="osd-aspect" focusId="watch-aspect" onClick={cycleAspect} />,
          <Button key="close" icon="close" label="Kapat" className="osd-close" focusId="watch-close" onClick={() => router.back()} />,
        ]}
      />
      {loading && !source ? (
        <div className="watch-loading">
          <div className="kb-spinner" />
          <span>{kind === 'live' ? 'Yayın açılıyor...' : 'Hazırlanıyor...'}</span>
        </div>
      ) : null}
    </div>
  );
}
