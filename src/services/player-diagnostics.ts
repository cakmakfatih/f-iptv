import type { Player } from 'zapkit-tv/player';

/** Opt-in, bounded media diagnostics. Never include source URLs, titles or error messages. */
export function installPlayerDiagnostics(player: Player): () => void {
  if (new URLSearchParams(window.location.search).get('playerDebug') !== '1') return () => {};
  const video = player.video;
  const run = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  let closed = false, sent = 0;
  const report = (event: string, extra: Record<string, string> = {}) => {
    if (closed || sent >= 40) return;
    const engine = player.engineName.peek();
    const type = player.source.peek()?.type;
    const params = new URLSearchParams({
      run, event, seq: String(++sent),
      engine: ['native', 'hls.js', 'dash'].includes(engine) ? engine : 'other',
      type: type && ['auto', 'hls', 'dash', 'progressive'].includes(type) ? type : 'none',
      state: String(player.getState()), ready: String(video.readyState), network: String(video.networkState),
      time: String(Math.round(video.currentTime || 0)), paused: String(video.paused),
      width: String(video.videoWidth), height: String(video.videoHeight), code: String(video.error?.code || 0),
      connected: String(video.isConnected), elementWidth: String(video.clientWidth), elementHeight: String(video.clientHeight),
      visible: String(typeof document === 'undefined' || !document.hidden),
      ...extra,
    });
    try {
      void fetch('/__player_diagnostics?' + params.toString(), {
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', keepalive: true,
      }).catch(() => {});
    } catch { /* Diagnostics must not interrupt playback. */ }
  };
  const canPlay = (mime: string, mse = false): string => {
    try {
      return mse ? String(typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime)) : video.canPlayType(mime) || 'no';
    } catch { return 'error'; }
  };
  const failure = (error: unknown) => {
    const name = (error as { name?: string })?.name || '';
    return ['NotSupportedError', 'NotAllowedError', 'AbortError', 'NetworkError', 'TypeError'].includes(name) ? name : 'OtherError';
  };
  const events = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting', 'stalled', 'error', 'abort', 'emptied', 'ended'];
  const handlers = events.map(event => {
    const handler = () => report(event);
    video.addEventListener(event, handler);
    return () => video.removeEventListener(event, handler);
  });
  const offState = player.on('onStateChange', () => report('state'));
  const offError = player.on('onError', info => report('sdk-error', {
    sdkCode: ['network', 'decode', 'unsupported', 'drm', 'manifest', 'aborted', 'unknown'].includes(info.code) ? info.code : 'unknown',
  }));
  const onUnhandled = (event: PromiseRejectionEvent) => report('unhandled', { reason: failure(event.reason) });
  window.addEventListener('unhandledrejection', onUnhandled);
  const originalPlay = video.play;
  const play: typeof video.play = function () {
    report('play-called');
    try {
      const result = originalPlay.call(video);
      if (result && typeof result.then === 'function') {
        void result.then(() => report('play-resolved'), error => report('play-rejected', { reason: failure(error) }));
      } else report('play-legacy');
      return result;
    } catch (error) {
      report('play-threw', { reason: failure(error) });
      throw error;
    }
  };
  video.play = play;
  report('attached', {
    hls: canPlay('application/vnd.apple.mpegurl'), mkv: canPlay('video/x-matroska'),
    mp4: canPlay('video/mp4; codecs="avc1.640029, mp4a.40.2"'),
    ac3: canPlay('audio/mp4; codecs="ac-3"'), mseAc3: canPlay('audio/mp4; codecs="ac-3"', true),
  });
  const timers = [5000, 15000].map(delay => setTimeout(() => report('snapshot-' + delay), delay));
  return () => {
    report('closed');
    closed = true;
    for (const timer of timers) clearTimeout(timer);
    for (const off of handlers) off();
    offState();
    offError();
    window.removeEventListener('unhandledrejection', onUnhandled);
    if (video.play === play) video.play = originalPlay;
  };
}
