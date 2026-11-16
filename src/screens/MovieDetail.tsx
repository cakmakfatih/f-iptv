import { h, Button, Icon, Image, useEffect, useState, type RouteProps } from 'zapkit-tv';
import { api, EVENTS } from '../services/api';
import { history } from '../services/history';
import { formatRating, yearOf } from '../services/format';
import { t } from '../i18n';
import { HintBar, ScreenHeader, useStartFocus, useWindowEvent } from '../components/ui';

export function MovieDetail({ router, entry, params, state }: RouteProps) {
  const id = decodeURIComponent(params.id || '');
  const supplied = (state as any)?.movie || {};
  const [info, setInfo] = useState<any>(null);
  const [, setTick] = useState(0);
  useEffect(() => { let active = true; api.getVodInfo(id).then(data => { if (active) setInfo(data); }); return () => { active = false; }; }, [id]);
  useWindowEvent(EVENTS.historyUpdated, () => setTick(n => n + 1));
  const meta = info?.info || {};
  const data = info?.movie_data || {};
  const name = meta.name || data.name || supplied.name || supplied.title || t('common.movie');
  const cover = api.normalizeImageUrl(meta.movie_image || meta.cover || data.stream_icon || supplied.stream_icon || '');
  const rating = formatRating(meta.rating || data.rating || supplied.rating);
  const details = [yearOf({ ...meta, release_date: meta.release_date || meta.releasedate }) || yearOf(data) || yearOf(supplied), meta.genre || data.genre].filter(Boolean).join(' • ');
  const plot = (meta.plot || meta.description || '').trim() || t('movieDetail.noPlot');
  const saved = history.getProgress(history.makeContentId('vod', id));
  const ext = data.container_extension || supplied.container_extension || 'mp4';
  const movie = { ...data, ...supplied, stream_id: id, name, stream_icon: cover, stream_url: supplied.stream_url || `${api.serverUrl}/movie/${api.username}/${api.password}/${id}.${ext}` };
  useStartFocus(router, entry, 'movie-detail-play', 'ready');
  return (
    <div className="screen-detail">
      <div className="detail__backdrop" style={{ backgroundImage: cover ? `url("${cover}")` : 'none' }} />
      <ScreenHeader title={name} />
      <div className="detail">
        <section className="detail__info">
          <Image src={cover || null} className="detail__poster" fallback={<div className="detail__poster detail__poster--fb">{name.slice(0, 2).toUpperCase()}</div>} />
          <div className="detail__meta">{rating ? <span className="detail__rating"><Icon name="star" /> {rating}</span> : null}{details ? <span>{details}</span> : null}</div>
          <div className="detail__label">{t('movieDetail.summary')}</div>
          <p className="detail__plot">{plot}</p>
          <Button icon="play" label={t('common.play')} focusId="movie-detail-play" className="detail__resume" onClick={() => router.navigate('/watch', { state: { kind: 'vod', movie, startTime: saved?.currentTime || 0 } })} />
        </section>
      </div>
      <HintBar hints={[[t('key.ok'), t('common.play')], [t('key.back'), t('detail.hint.back')]]} />
    </div>
  );
}
