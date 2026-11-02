import { h, Button, FocusGroup, Icon, VirtualList, focus, useEffect, useState, type RouteProps } from 'zapkit-tv';
import { api, EVENTS } from '../services/api';
import { history, type WatchProgressItem } from '../services/history';
import { formatClock, formatNumber } from '../services/format';
import { t } from '../i18n';
import { Brand, Clock, HintBar, PosterCard, openAccount, useDeleteKey, useScreenKeys, useWindowEvent } from '../components/ui';
import { ListEditButton, confirmRemoveEntries, entryKey, useListEditing } from '../components/list-edit';

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

const fmt = formatNumber;

const sections = () =>
  [
    { id: 'live', path: '/live', title: t('home.live.title'), sub: t('home.live.sub'), icon: 'radio', label: 'home.live.count', empty: t('home.live.empty') },
    { id: 'vod', path: '/movies', title: t('home.vod.title'), sub: t('home.vod.sub'), icon: 'film', label: 'home.vod.count', empty: t('home.vod.empty') },
    { id: 'series', path: '/series', title: t('home.series.title'), sub: t('home.series.sub'), icon: 'series', label: 'home.series.count', empty: t('home.series.empty') },
  ] as const;

export function Home({ router, entry }: RouteProps) {
  const [stats, setStats] = useState<HomeStats | null>(statsCache && statsCache.account === api.getAccountKey() ? statsCache : null);
  const [recents, setRecents] = useState<WatchProgressItem[]>(() => history.getRecentList(10));
  const [recentIndex, setRecentIndex] = useState(0);
  // Edit mode of the Continue Watching list: OK checks cards, Delete removes the checked ones.
  const edit = useListEditing();

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
        // contentId is "vod_<stream id>"; the player rebuilds that id from the plain stream id, so pass the plain one
        // (otherwise the saved position is not found and a second, duplicate history entry is created).
        state: {
          kind: 'vod',
          movie: { stream_id: item.contentId.replace(/^vod_/, ''), name: item.title, stream_url: item.streamUrl, stream_icon: item.cover },
          startTime: item.currentTime || 0,
        },
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
    // Home is the first screen after a profile was chosen: Back returns to the picker instead of leaving the app
    // (while editing the list it only leaves edit mode).
    if (key === 'back') {
      if (edit.editing) stopEditing();
      else switchProfile();
      return true;
    }
    if (key === 'red') return router.navigate('/live'), true;
    if (key === 'green') return router.navigate('/movies'), true;
    if (key === 'yellow') return router.navigate('/series'), true;
    if (key === 'blue') return openAccount(), true;
    return false;
  });

  const startEditing = () => {
    edit.start();
    requestAnimationFrame(() => focus.focusFirst(document.querySelector('.home-recents')));
  };
  const stopEditing = () => {
    edit.stop();
    requestAnimationFrame(() => focus.focusById('home-recent-edit'));
  };
  const deleteChecked = () =>
    confirmRemoveEntries(
      recents.filter((it) => edit.has(entryKey(it))),
      stopEditing,
    );

  // Leave edit mode when the list is empty.
  useEffect(() => {
    if (!recents.length && edit.editing) edit.stop();
  }, [recents.length]);

  // Delete (or the red key) removes the checked cards while editing.
  useDeleteKey(router, entry, () => {
    if (!edit.editing) return false;
    deleteChecked();
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
        <div className="home__greeting">{api.profileName}</div>
        <FocusGroup className="home__actions" orientation="horizontal">
          <Button icon="account" label={t('home.account')} focusId="home-account" onClick={openAccount} />
          <Button icon="users" label={t('home.profiles')} focusId="home-profiles" onClick={switchProfile} />
        </FocusGroup>
        <Clock withDate />
      </header>

      <FocusGroup className="home__sections" orientation="horizontal" enterTo="first">
        {sections().map((s, i) => {
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
              <div className="section-card__tag">{c ? t(s.label, { n: fmt(c[0]) }) : '...'}</div>
              <div className="section-card__title">{s.title}</div>
              <div className="section-card__sub">{s.sub}</div>
              <div className="section-card__foot">
                <span>{c ? (c[0] > 0 ? t('home.categories', { n: fmt(c[1]) }) : s.empty) : t('common.loading')}</span>
                <span className="section-card__cta">{t('home.start')}</span>
              </div>
              <span className={['color-key', 'color-key--' + s.id]} />
            </div>
          );
        })}
      </FocusGroup>

      <section className="home__continue">
        <div className="home__continue-head">
          <h2>{t('home.continue')}</h2>
          {recents.length ? (
            <ListEditButton editing={edit.editing} count={edit.count} focusId="home-recent-edit" onEdit={startEditing} onDelete={deleteChecked} onCancel={stopEditing} />
          ) : null}
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
            onSelect={(it) => (edit.editing ? edit.toggle(entryKey(it)) : resume(it))}
            renderItem={(it, _i, st) => (
              <div className="resume-card">
                <PosterCard
                  title={it.seriesName || it.title}
                  image={it.cover}
                  progress={it.progressPercent}
                  badge={it.streamType === 'series' ? t('home.badge.series') : t('home.badge.movie')}
                  focused={st.focused}
                  selectable={edit.editing}
                  selected={edit.has(entryKey(it))}
                  meta={
                    it.streamType === 'series'
                      ? t('home.meta.episode', { s: it.seasonNum || 1, e: it.episodeNum || 1, t: formatClock(it.currentTime) })
                      : t('home.meta.movie', { t: formatClock(it.currentTime) })
                  }
                />
              </div>
            )}
          />
        ) : (
          <div className="resume-empty" focusable focusId="home-recent-empty" onClick={() => router.navigate('/series')}>
            <span className="resume-empty__badge">{t('home.empty.badge')}</span>
            <div>
              <div className="resume-empty__title">{t('home.empty.title')}</div>
              <div className="resume-empty__text">{t('home.empty.text')}</div>
            </div>
          </div>
        )}
      </section>

      <HintBar
        hints={
          edit.editing
            ? [
                [t('key.ok'), t('edit.hint.toggle')],
                [t('key.del'), t('edit.hint.delete')],
                ['◀ ▶', t('hint.navigate')],
                [t('key.back'), t('common.cancel')],
              ]
            : [
                [t('key.ok'), t('hint.select')],
                ['▲▼', t('hint.row')],
                [t('key.color'), t('hint.shortcuts')],
                [t('key.back'), t('hint.profiles')],
              ]
        }
      />
    </div>
  );
}
