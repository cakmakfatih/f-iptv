/**
 * F-IPTV's own player controls. The SDK player only ships play/pause, seeking,
 * the progress bar and settings (plus previous/next for playlists); everything
 * specific to this app (labelled next episode, back to live, the "up next" card,
 * playlist position) is built here from the player's public API.
 */
import { h, Button, Image, focus, toast, useEffect, useSignalValue } from 'zapkit-tv';
import type { Player } from 'zapkit-tv/player';
import { t } from '../i18n';

/** Previous episode (series), left of "Next episode". On the first one it says so instead of doing nothing. */
export function PreviousEpisodeButton({ player }: { player: Player }) {
  const index = useSignalValue(player.playlistIndex);
  const list = useSignalValue(player.playlist);
  const prev = index > 0 && index < list.length ? list[index - 1] : null;
  return (
    <Button
      icon="previous"
      label={t('player.prevEpisode')}
      className="osd-prev"
      focusId="watch-prev-episode"
      title={prev ? prev.subtitle : undefined}
      // playVideoAt, not previousVideo(): that one only restarts the episode when it is more than 3 s in.
      onClick={() => (prev ? void player.playVideoAt(index - 1) : toast(t('watch.firstEpisode'), { kind: 'info' }))}
    />
  );
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
