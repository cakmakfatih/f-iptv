/**
 * F-IPTV's own player controls. The SDK player only ships play/pause, seeking,
 * the progress bar and settings; everything specific to this app (next episode,
 * previous/next channel, back to live, the "up next" card, playlist position)
 * is built here from the player's public API.
 */
import { h, Button, Image, focus, toast, useEffect, useSignalValue } from 'zapkit-tv';
import type { Player } from 'zapkit-tv/player';

/** Next episode (series). On the last one it says so instead of doing nothing. */
export function NextEpisodeButton({ player }: { player: Player }) {
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

/** Previous / next channel beside the transport controls (live TV). */
export function ChannelSkipButton({ player, dir }: { player: Player; dir: 'previous' | 'next' }) {
  useSignalValue(player.playlistIndex);
  const can = dir === 'next' ? player.hasNext() : player.hasPrevious();
  return (
    <Button
      icon={dir}
      ariaLabel={dir === 'next' ? 'Sonraki Kanal' : 'Önceki Kanal'}
      disabled={!can}
      onClick={() => (dir === 'next' ? player.nextVideo() : player.previousVideo())}
    />
  );
}

/** Jumps back to the live edge when a live stream was paused or rewound. */
export function GoLiveButton({ player }: { player: Player }) {
  const mode = useSignalValue(player.liveMode);
  useSignalValue(player.currentTime);
  if (mode === 'none' || player.isAtLiveHead()) return null;
  return <Button icon="live" label="Canlıya Dön" className="osd-golive" focusId="watch-go-live" onClick={() => player.seekToLiveHead()} />;
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
          <div className="upnext__eyebrow">{counting ? `${info.countdown} sn içinde başlıyor` : 'Sıradaki Bölüm'}</div>
          <div className="upnext__title">{src.title || ''}</div>
          {src.subtitle ? <div className="upnext__subtitle">{src.subtitle}</div> : null}
        </div>
      </div>
      <div className="upnext__actions">
        <Button icon="next" label="Şimdi Oynat" focusId="upnext-play" autoFocus={counting} className="upnext__play" onClick={() => player.playUpNext()} />
        <Button label="Vazgeç" focusId="upnext-cancel" onClick={() => player.dismissUpNext()} />
      </div>
      {counting ? <div className="upnext__bar" style={{ animationDuration: info.countdown + 's' }} /> : null}
    </div>
  );
}
