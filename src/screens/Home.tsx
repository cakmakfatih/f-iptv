import { h, Button, FocusGroup, Icon, VirtualList, focus, useEffect, useState, type RouteProps } from 'zapkit-tv';
import { api, EVENTS } from '../services/api';
import { history, type WatchProgressItem } from '../services/history';
import { formatClock } from '../services/format';
import { Brand, Clock, HintBar, PosterCard, openAccount, openConfirm, useDeleteKey, useScreenKeys, useWindowEvent } from '../components/ui';

interface HomeStats {
  live: number;
  liveCats: number;
  vod: number;
  vodCats: number;
  series: number;
  seriesCats: number;
  at: number;
  account: string;
}

const STATS_TTL = 5 * 60 * 1000;
let statsCache: HomeStats | null = null;

async function loadStats(force = false): Promise<HomeStats> {
  const account = api.getAccountKey();
  if (!force && statsCache && statsCache.account === account && Date.now() - statsCache.at < STATS_TTL) return statsCache;
  const [live, liveCats, vod, vodCats, series, seriesCats] = await Promise.all([
    api.getLiveStreams(),
    api.getLiveCategories(),
    api.getVodStreams(),
    api.getVodCategories(),
    api.getSeriesList(),
    api.getSeriesCategories(),
  ]);
  const stats = {
    live: live.length,
    liveCats: liveCats.length,
    vod: vod.length,
    vodCats: vodCats.length,
    series: series.length,
    seriesCats: seriesCats.length,
    at: Date.now(),
    account,
  };
  // An all-empty result means the server was unreachable: do not keep it.
  if (stats.live + stats.vod + stats.series > 0) statsCache = stats;
  return stats;
}

const fmt = (n: number) => n.toLocaleString('tr-TR');

const SECTIONS = [
  { id: 'live', path: '/live', title: 'Canlı TV', sub: 'Ulusal, Spor, Sinema ve Belgesel Canlı Yayınları', icon: 'radio', label: 'KANAL', empty: 'Henüz kanal yok' },
  { id: 'vod', path: '/movies', title: 'Filmler', sub: 'Film Kütüphanesi', icon: 'film', label: 'FİLM', empty: 'Henüz film yok' },
  { id: 'series', path: '/series', title: 'Diziler', sub: 'Popüler Diziler, Tüm Sezonlar & Bölüm Arşivi', icon: 'series', label: 'DİZİ', empty: 'Henüz dizi yok' },
] as const;

export function Home({ router, entry }: RouteProps) {
  const [stats, setStats] = useState<HomeStats | null>(statsCache && statsCache.account === api.getAccountKey() ? statsCache : null);
  const [recents, setRecents] = useState<WatchProgressItem[]>(() => history.getRecentList(10));
  const [recentIndex, setRecentIndex] = useState(0);

  const refreshStats = (force = false) =>
    loadStats(force).then((s) => {
      setStats(s);
    });

  useEffect(() => {
    refreshStats();
  }, []);
  useWindowEvent(EVENTS.historyUpdated, () => setRecents(history.getRecentList(10)));
  useWindowEvent(EVENTS.contentUpdated, () => {
    statsCache = null;
    refreshStats(true);
  });

  const resume = (item: WatchProgressItem) => {
    if (item.streamType === 'series' && item.seriesId != null) {
      router.navigate('/watch', {
        state: {
          kind: 'series',
          seriesId: String(item.seriesId),
          seriesName: item.seriesName || item.title,
          episodeId: String(item.episodeId),
          cover: item.cover || '',
          startTime: item.currentTime || 0,
        },
      });
    } else {
      router.navigate('/watch', {
        state: { kind: 'vod', movie: { stream_id: item.contentId, name: item.title, stream_url: item.streamUrl, stream_icon: item.cover } },
      });
    }
  };

  // Back to the profile picker; the login stays saved with its own history.
  const switchProfile = () => {
    statsCache = null;
    api.signOut();
    router.reset('/profiles');
  };

  useScreenKeys(router, entry, (key) => {
    if (key === 'red') return router.navigate('/live'), true;
    if (key === 'green') return router.navigate('/movies'), true;
    if (key === 'yellow') return router.navigate('/series'), true;
    if (key === 'blue') return openAccount(), true;
    return false;
  });

  // Same history as the series "Kaldığın Yerden" list; films are in it too, so this clears both kinds.
  const clearAll = () =>
    openConfirm({
      title: 'İzleme Geçmişini Temizle',
      message: 'İzlemeye devam et listenizdeki tüm diziler ve filmler ile izleme geçmişiniz silinecektir. Bu işlem geri alınamaz.',
      confirmText: 'Evet, Temizle',
      cancelText: 'Vazgeç',
      danger: true,
      onConfirm: () => {
        history.clearAll();
        requestAnimationFrame(() => focus.focusById('home-recent-empty'));
      },
    });

  // Delete on a "continue watching" card removes it.
  useDeleteKey(router, entry, () => {
    const cur = focus.current;
    if (cur && cur.closest('.home__continue-head') && recents.length) {
      clearAll();
      return true;
    }
    if (!cur || !cur.closest('.home-recents') || !recents.length) return false;
    const item = recents[Math.min(recentIndex, recents.length - 1)];
    openConfirm({
      title: 'İzleme Geçmişini Temizle',
      message: `"${item.seriesName || item.title}" kaydını izlemeye devam et listesinden silmek istiyor musunuz?`,
      confirmText: 'Kaldır',
      cancelText: 'Vazgeç',
      danger: true,
      // A series card stands for the whole series; removing one episode would surface an older one.
      onConfirm: () => (item.streamType === 'series' && item.seriesId != null ? history.clearSeriesItem(item.seriesId) : history.clearProgress(item.contentId)),
    });
    return true;
  });

  const counts = stats
    ? { live: [stats.live, stats.liveCats], vod: [stats.vod, stats.vodCats], series: [stats.series, stats.seriesCats] }
    : null;

  return (
    <div className="home">
      <div className="home__bg" />
      <header className="home__top">
        <Brand />
        <div className="home__greeting">
          Hoş geldin{api.user?.username ? ', ' : ''}
          <b>{api.user?.username || ''}</b>
        </div>
        <FocusGroup className="home__actions" orientation="horizontal">
          <Button icon="account" label="Hesap" focusId="home-account" onClick={openAccount} />
          <Button icon="users" label="Oturumlar" focusId="home-profiles" onClick={switchProfile} />
        </FocusGroup>
        <Clock withDate />
      </header>

      <FocusGroup className="home__sections" orientation="horizontal" enterTo="first">
        {SECTIONS.map((s, i) => {
          const c = counts ? counts[s.id] : null;
          return (
            <div
              key={s.id}
              className={['section-card', 'section-card--' + s.id]}
              focusable
              focusId={'home-' + s.id}
              autoFocus={i === 0}
              onClick={() => router.navigate(s.path)}
            >
              <div className="section-card__icon">
                <Icon name={s.icon} />
              </div>
              <div className="section-card__tag">{c ? `${fmt(c[0])} ${s.label}` : '...'}</div>
              <div className="section-card__title">{s.title}</div>
              <div className="section-card__sub">{s.sub}</div>
              <div className="section-card__foot">
                <span>{c ? (c[0] > 0 ? `${fmt(c[1])} kategori` : s.empty) : 'Yükleniyor...'}</span>
                <span className="section-card__cta">Hemen Başlat →</span>
              </div>
              <span className={['color-key', 'color-key--' + s.id]} />
            </div>
          );
        })}
      </FocusGroup>

      <section className="home__continue">
        <div className="home__continue-head">
          <h2>İzlemeye Devam Et</h2>
          {recents.length ? <Button icon="trash" label="Listeyi Temizle" className="btn-danger-soft" focusId="home-recent-clear" onClick={clearAll} /> : null}
        </div>
        {recents.length ? (
          <VirtualList
            key={'recents-' + recents.length}
            className="home-recents"
            orientation="horizontal"
            items={recents}
            itemSize={440}
            columnSize={300}
            gap={28}
            viewportSize={1792}
            focusPrefix="recent"
            keyOf={(it) => it.contentId}
            onFocusIndex={setRecentIndex}
            onSelect={resume}
            renderItem={(it, _i, st) => (
              <div className="resume-card">
                <PosterCard
                  title={it.seriesName || it.title}
                  image={it.cover}
                  progress={it.progressPercent}
                  badge={it.streamType === 'series' ? 'DİZİ' : 'FİLM'}
                  focused={st.focused}
                  meta={
                    it.streamType === 'series'
                      ? `Sezon ${it.seasonNum || 1} • Bölüm ${it.episodeNum || 1} • ${formatClock(it.currentTime)}`
                      : `Kaldığın Yer: ${formatClock(it.currentTime)}`
                  }
                />
              </div>
            )}
          />
        ) : (
          <div className="resume-empty" focusable focusId="home-recent-empty" onClick={() => router.navigate('/series')}>
            <span className="resume-empty__badge">BAŞLA</span>
            <div>
              <div className="resume-empty__title">Henüz izleme geçmişi yok</div>
              <div className="resume-empty__text">Dizi veya Film izleyerek kaldığın yeri kaydet</div>
            </div>
          </div>
        )}
      </section>

      <HintBar
        hints={[
          ['OK', 'Seç'],
          ['▲▼', 'Satır'],
          ['SİL', 'Geçmişten Kaldır'],
          ['RENKLİ', 'Kısayollar'],
          ['GERİ', 'Çık'],
        ]}
      />
    </div>
  );
}
