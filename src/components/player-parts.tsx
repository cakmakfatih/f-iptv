/**
 * F-IPTV's own player controls. The SDK player only ships play/pause, seeking,
 * the progress bar and settings (plus previous/next for playlists); everything
 * specific to this app (labelled next episode, back to live, the "up next" card,
 * playlist position) is built here from the player's public API.
 */
import { h, Button, FocusGroup, Icon, Image, VirtualList, focus, openOverlay, toast, useEffect, useRef, useSignalValue } from 'zapkit-tv';
import type { Player } from 'zapkit-tv/player';
import { t } from '../i18n';

function EpisodePicker({ player, close }: { player: Player; close: () => void }) {
  const list = useSignalValue(player.playlist);
  const index = Math.max(0, useSignalValue(player.playlistIndex));
  useEffect(() => {
    const frame = requestAnimationFrame(() => focus.focusById('watch-episode-' + index));
    return () => cancelAnimationFrame(frame);
  }, [index]);
  const rows = Math.min(6, list.length);
  return (
    <div className="dialog dialog--wide" aria-label={t('player.allEpisodes')}>
      <h2 className="dialog__title">{t('player.allEpisodes')}</h2>
      <div className="dialog__list">
        <VirtualList
          key={'watch-episodes-' + index}
          className="lang-list"
          items={list}
          itemSize={72}
          gap={6}
          viewportSize={rows * 72 + Math.max(0, rows - 1) * 6}
          align="center"
          initialIndex={index}
          focusPrefix="watch-episode"
          keyOf={(_source, i) => String(i)}
          onSelect={(_source, i) => {
            close();
            if (i !== player.playlistIndex.peek()) void player.playVideoAt(i).catch(() => toast(t('player.errorTitle'), { kind: 'error' }));
          }}
          renderItem={(source, i) => (
            <div className={['cat', { 'cat--selected': i === index }]} aria-current={i === index ? 'true' : undefined}>
              <span className="cat__name">{source.subtitle || source.title || t('common.episode', { n: i + 1 })}</span>
              {i === index ? <Icon name="check" /> : null}
            </div>
          )}
        />
      </div>
      <FocusGroup className="dialog__actions" orientation="horizontal">
        <Button label={t('common.close')} onClick={close} />
      </FocusGroup>
    </div>
  );
}

/** Opens the existing playlist at the playing episode, including its scroll position. */
export function AllEpisodesButton({ player }: { player: Player }) {
  const list = useSignalValue(player.playlist);
  const overlay = useRef<ReturnType<typeof openOverlay> | null>(null);
  useEffect(() => () => overlay.current?.close(), []);
  return <Button icon="series" label={t('player.allEpisodes')} focusId="watch-all-episodes" disabled={!list.length} onClick={() => {
    if (overlay.current && !overlay.current.closed) return;
    overlay.current = openOverlay(close => <EpisodePicker player={player} close={close} />, { className: 'overlay-dim' });
  }} />;
}

/** Next episode (series). On the last one it says so instead of doing nothing. */
export function NextEpisodeButton({ player }: { player: Player }) {
  const index = useSignalValue(player.playlistIndex);
  const list = useSignalValue(player.playlist);
  const next = index >= 0 && index + 1 < list.length ? list[index + 1] : null;
  return (
    <Button
      icon="next"
      label={t('player.nextEpisode')}
      className="osd-next"
      focusId="watch-next-episode"
      title={next ? next.subtitle : undefined}
      onClick={() => (next ? player.nextVideo() : toast(t('watch.lastEpisode'), { kind: 'info' }))}
    />
  );
}

/** Jumps back to the live edge when a live stream was paused or rewound. */
export function GoLiveButton({ player }: { player: Player }) {
  const mode = useSignalValue(player.liveMode);
  useSignalValue(player.currentTime);
  if (mode === 'none' || player.isAtLiveHead()) return null;
  return <Button icon="live" label={t('player.goLive')} className="osd-golive" focusId="watch-go-live" onClick={() => player.seekToLiveHead()} />;
}

/** "7 / 20" chip under the title for playlists (episodes, channels). */
export function PlaylistPosition({ player }: { player: Player }) {
  const list = useSignalValue(player.playlist);
  const index = useSignalValue(player.playlistIndex);
  if (list.length < 2 || index < 0) return null;
  return (
    <span className="osd-meta__tag">
      {index + 1} / {list.length}
    </span>
  );
}

/**
 * Card for the next episode: a small suggestion near the end, a centred countdown
 * once the episode ended. It marks itself as an overlay so the player's own key
 * handling stands aside while it has focus; Back dismisses it.
 */
export function UpNextCard({ player }: { player: Player }) {
  const info = useSignalValue(player.upNext);
  const counting = !!info && info.countdown != null;
  const key = info ? info.index + ':' + counting : '';

  // The card takes focus when it appears or starts counting down.
  useEffect(() => {
    if (info) requestAnimationFrame(() => focus.focusById('upnext-play'));
  }, [key]);

  useEffect(() => {
    if (!info) return;
    return focus.onKey((k) => {
      if (k !== 'back') return false;
      player.dismissUpNext();
      return true;
    }, 20);
  }, [!!info]);

  if (!info) return null;
  const src = info.source;
  return (
    <div className={['upnext', { 'upnext--countdown': counting }]} data-kb-overlay="true" focusGroup={{ orientation: 'horizontal', trap: counting ? true : undefined }}>
      <div className="upnext__body">
        {src.poster ? <Image className="upnext__poster" src={src.poster} alt="" /> : null}
        <div className="upnext__text">
          <div className="upnext__eyebrow">{counting ? t('player.startsIn', { s: info.countdown ?? 0 }) : t('player.upNext')}</div>
          <div className="upnext__title">{src.title || ''}</div>
          {src.subtitle ? <div className="upnext__subtitle">{src.subtitle}</div> : null}
        </div>
      </div>
      <div className="upnext__actions">
        <Button icon="next" label={t('player.playNow')} focusId="upnext-play" autoFocus={counting} className="upnext__play" onClick={() => player.playUpNext()} />
        <Button label={t('common.cancel')} focusId="upnext-cancel" onClick={() => player.dismissUpNext()} />
      </div>
      {counting ? <div className="upnext__bar" style={{ animationDuration: info.countdown + 's' }} /> : null}
    </div>
  );
}
