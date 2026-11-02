import { h, Button, Icon, Image, VirtualList, focus, useEffect, useMemo, useState, type RouteProps } from 'zapkit-tv';
import { api, EVENTS } from '../services/api';
import { history } from '../services/history';
import { formatClock, formatEpisodeTitle, formatRating, yearOf } from '../services/format';
import { EmptyState, HintBar, Loading, ScreenHeader, useStartFocus, useWindowEvent } from '../components/ui';

function episodeProgress(seriesId: string, ep: any) {
  return history.getEpisodeProgress(seriesId, ep.id) || history.getEpisodeProgress(seriesId, Number(ep.episode_num) || 1);
}

export function SeriesDetail({ router, entry, params, state }: RouteProps) {
  const seriesId = decodeURIComponent(params.id || '');
  const listItem = (state && (state as any).series) || null;
  const [info, setInfo] = useState<any | null>(null);
  const [failed, setFailed] = useState(false);
  const [season, setSeason] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = () =>
    api.getSeriesInfo(seriesId).then((data) => {
      if (!data) return setFailed(true);
      setFailed(false);
      setInfo(data);
    });

  useEffect(() => {
    load();
  }, []);

  // Progress bars follow the history (e.g. after coming back from the player).
  useWindowEvent(EVENTS.historyUpdated, () => setTick((n) => n + 1));
  useWindowEvent(EVENTS.contentUpdated, (e) => {
    const kinds: string[] = (e as CustomEvent).detail?.kinds || [];
    if (kinds.includes('series')) load();
  });

  const seasons = useMemo(() => {
    const keys = Object.keys((info && info.episodes) || {}).sort((a, b) => Number(a) - Number(b));
    return keys.length ? keys : ['1'];
  }, [info]);

  // Start on the season of the last watched episode, otherwise the first one.
  useEffect(() => {
    if (!info) return;
    const last = history.getSeriesContinueList().find((x) => String(x.seriesId) === seriesId);
    const want = last && seasons.includes(String(last.seasonNum)) ? String(last.seasonNum) : seasons[0];
    setSeason((cur) => (cur && seasons.includes(cur) ? cur : want));
  }, [info]);

  const meta = (info && info.info) || {};
  const name = meta.name || (listItem && listItem.name) || 'Dizi';
  const cover = meta.cover || (listItem && listItem.cover) || api.getCachedCover(seriesId);
  const rating = formatRating(meta.rating || (listItem && listItem.rating));
  const metaText = [yearOf(meta) || (listItem && yearOf(listItem)), meta.genre || (listItem && listItem.genre)].filter(Boolean).join(' • ');
  const plot = (meta.plot || '').trim() || `${name} - Tüm sezon ve bölümleriyle yüksek çözünürlükte yayında.`;
  const episodes: any[] = (info && season && info.episodes && info.episodes[season]) || [];

  const play = (ep: any) => {
    const saved = episodeProgress(seriesId, ep);
    router.navigate('/watch', {
      state: {
        kind: 'series',
        seriesId,
        seriesName: name,
        episodeId: String(ep.id),
        cover,
        startTime: saved ? saved.currentTime : 0,
        info,
      },
    });
  };

  const resume = history.getSeriesContinueList().find((x) => String(x.seriesId) === seriesId);
  const resumeEp = resume ? (info && info.episodes && Object.values(info.episodes).flat().find((e: any) => String(e.id) === String(resume.episodeId))) : null;
  const seasonIndex = Math.max(0, seasons.indexOf(season || seasons[0]));

  // First focus: the season list (the first season unless an episode was watched before).
  useStartFocus(router, entry, 'season-' + (season || seasons[0]), (info ? 'ready:' : 'loading:') + season);

  return (
    <div className="screen-detail">
      <div className="detail__backdrop" style={{ backgroundImage: cover ? `url("${cover}")` : 'none' }} />
      <ScreenHeader title={name} count={info ? `${seasons.length} Sezon` : undefined} />
      {failed && !info ? (
        <EmptyState icon="alert" title="Dizi bilgileri alınamadı" text="Sunucuya ulaşılamadı. Lütfen tekrar deneyin.">
          <Button icon="refresh" label="Tekrar Dene" autoFocus onClick={load} />
        </EmptyState>
      ) : !info ? (
        <Loading text="Sezonlar ve bölümler yükleniyor..." />
      ) : (
        <div className="detail">
          <section className="detail__info">
            <Image src={cover || null} className="detail__poster" fallback={<div className="detail__poster detail__poster--fb">{name.slice(0, 2).toUpperCase()}</div>} />
            <div className="detail__meta">
              {rating ? <span className="detail__rating">
                  <Icon name="star" /> {rating}
                </span> : null}
              {metaText ? <span>{metaText}</span> : null}
            </div>
            <div className="detail__label">DİZİ ÖZETİ</div>
            <p className="detail__plot">{plot}</p>
            {resume && resumeEp ? (
              <Button
                icon="play"
                label={`Devam Et · S${resume.seasonNum || 1} B${resume.episodeNum || 1} · ${formatClock(resume.currentTime)}`}
                focusId="detail-resume"
                className="detail__resume"
                onClick={() => play(resumeEp)}
              />
            ) : null}
          </section>
          <section className="detail__seasons">
            <div className="sidebar__title">SEZONLAR</div>
            <VirtualList
              key={'seasons-' + seasons.join(',')}
              className="season-list"
              items={seasons}
              itemSize={68}
              gap={6}
              viewportSize={720}
              focusPrefix="season"
              initialIndex={seasonIndex}
              keyOf={(s) => s}
              onFocusIndex={(i) => setSeason(seasons[i])}
              onSelect={() => focus.focusFirst(document.querySelector('.screen-detail .episode-list'))}
              renderItem={(s) => (
                <div className={['cat', { 'cat--selected': s === season }]}>
                  <span className="cat__name">Sezon {s}</span>
                  <span className="cat__count">{((info.episodes && info.episodes[s]) || []).length}</span>
                </div>
              )}
            />
          </section>
          <section className="detail__episodes">
            <div className="sidebar__title">BÖLÜMLER · Sezon {season}</div>
            {episodes.length === 0 ? (
              <EmptyState icon="series" title="Bu sezonda bölüm yok" />
            ) : (
              <VirtualList
                key={'episodes-' + season}
                className="episode-list"
                items={episodes}
                itemSize={104}
                gap={10}
                viewportSize={720}
                focusPrefix="episode"
                keyOf={(ep) => String(ep.id)}
                onSelect={play}
                renderItem={(ep) => {
                  const num = Number(ep.episode_num) || 1;
                  const saved = episodeProgress(seriesId, ep);
                  const pct = saved && saved.currentTime > 5 ? saved.progressPercent : 0;
                  const img = ep.info && ep.info.movie_image ? api.normalizeImageUrl(ep.info.movie_image) : cover;
                  return (
                    <div className="episode">
                      <div className="episode__thumb">
                        <Image src={img || null} className="episode__img" fallback={<span className="episode__num-fb">{num}</span>} />
                        <span className="episode__num">{num}</span>
                      </div>
                      <div className="episode__body">
                        <div className="episode__title">{formatEpisodeTitle(ep.title, num)}</div>
                        <div className="episode__meta">
                          {ep.info && ep.info.duration ? ep.info.duration : `Bölüm ${num}`}
                          {pct ? ` · Kaldığın yer ${formatClock(saved!.currentTime)}` : ''}
                        </div>
                        {pct ? (
                          <div className="episode__progress">
                            <div style={{ width: pct + '%' }} />
                          </div>
                        ) : null}
                      </div>
                      <span className="episode__play">
                        <Icon name="play" /> Oynat
                      </span>
                    </div>
                  );
                }}
              />
            )}
          </section>
        </div>
      )}
      <HintBar hints={[['◀ ▶', 'Özet / Sezon / Bölüm'], ['▲ ▼', 'Gezin'], ['OK', 'Bölümü Oynat'], ['GERİ', 'Dizilere Dön']]} />
    </div>
  );
}
