import { Player, PlayerState, loadPrefs, type PlayerOptions, type CaptionTrack, type VideoSource } from 'zapkit-tv/player';
import { t } from '../i18n';
import { trackLanguage } from './player-tracks';
import { vodSource } from './media';

type Choice = { type: 'original' } | { type: 'language' | 'label'; value: string };
type Preferences = { audio: Choice | null; captions: Choice | 'off' | null };
const STORAGE_KEY = 'f-iptv-track-preferences';

function choice(track: { lang: string; label: string }): Choice | null {
  if (/^(original(?: audio)?|orijinal)$/i.test(track.label.trim())) return { type: 'original' };
  const lang = trackLanguage(track.lang);
  if (lang) return { type: 'language', value: lang };
  const label = track.label.trim().toLowerCase();
  return label && !/^(audio|ses|track|altyazı|subtitles?)\s*\d*$/.test(label) ? { type: 'label', value: label } : null;
}

function validChoice(value: unknown): value is Choice {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Choice;
  return entry.type === 'original' || ((entry.type === 'language' || entry.type === 'label') && typeof entry.value === 'string' && entry.value.length > 0 && entry.value.length <= 160);
}

function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && (saved.audio === null || validChoice(saved.audio)) && (saved.captions === null || saved.captions === 'off' || validChoice(saved.captions))) return saved;
  } catch { /* Ignore unavailable storage or invalid preferences. */ }
  const legacy = loadPrefs();
  return {
    audio: trackLanguage(legacy.audioLang) ? { type: 'language', value: trackLanguage(legacy.audioLang) } : null,
    captions: legacy.captionsOn && trackLanguage(legacy.captionLang) ? { type: 'language', value: trackLanguage(legacy.captionLang) } : 'off',
  };
}

function preferred<T extends { lang: string; label: string }>(tracks: T[], saved: Choice | null): T | undefined {
  if (!saved) return undefined;
  return tracks.find(track => {
    if (saved.type === 'language') return trackLanguage(track.lang) === saved.value;
    if (saved.type === 'label') return track.label.trim().toLowerCase() === saved.value;
    return choice(track)?.type === 'original';
  });
}

const STARTUP_BUFFER_SECONDS = 5;
const STARTUP_LIMIT_MS = 16000;
const PLAYBACK_STALL_MS = 25000;
const SEEK_STALL_MS = 15000;
const IDLE_REOPEN_MS = 45000;

type RecoveryMode = 'play' | 'seek';

interface PlaybackRecovery {
  source: VideoSource;
  position: number;
  lastProgressAt: number | null;
  retryFrom: number | null;
  mode: RecoveryMode | null;
  pausedAt: number | null;
}

function waitForStartupBuffer(video: HTMLVideoElement, startTime: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const deadline = Date.now() + STARTUP_LIMIT_MS;
    const finish = () => {
      clearInterval(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const check = () => {
      if (Date.now() >= deadline) return finish();
      const position = Math.max(startTime, video.currentTime);
      const remaining = video.duration - position;
      const target = remaining > 0 ? Math.min(STARTUP_BUFFER_SECONDS, remaining) : STARTUP_BUFFER_SECONDS;
      const buffered = video.buffered;
      for (let i = 0; i < buffered.length; i++) {
        const ahead = buffered.end(i) - position;
        if (buffered.start(i) <= position + 0.1 && ahead > 0 && ahead >= target - 0.1) return finish();
      }
    };
    const timer = setInterval(check, 125);
    signal.addEventListener('abort', finish, { once: true });
    check();
  });
}

/** Track identities persist across titles; automatic fallbacks never replace the viewer's choice. */
export class RememberingPlayer extends Player {
  private choices = readPreferences();
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private ignoreSdkCaptionRestore = false;
  private captionTarget: string | null | undefined;
  private captionVersion = 0;
  private episodeRequest = 0;
  private episodeAbort: AbortController | null = null;
  private preferenceCleanups: Array<() => void>;
  private startup: { abort: AbortController; pending: Promise<void> } | null = null;
  private startupComplete = false;
  private recovery: PlaybackRecovery | null = null;
  private automaticRetry: RecoveryMode | null = null;

  constructor(options: PlayerOptions = {}) {
    super(options);
    // The app restores semantic track preferences; disable the SDK's separate language restore.
    (this as unknown as { prefs: { audioLang: string } }).prefs.audioLang = '';
    this.preferenceCleanups = [
      this.on('onVideoDataChange', source => {
        this.cancelStartup();
        this.startupComplete = false;
        const kind = source?.metadata?.kind;
        const position = this.currentTime.peek();
        const mode = this.automaticRetry;
        this.recovery = source && !source.live && (kind === 'series' || kind === 'vod')
          ? { source, position, mode, lastProgressAt: mode ? Date.now() : null, retryFrom: mode ? position : null,
              pausedAt: mode === 'seek' ? Date.now() : null }
          : null;
        (this as unknown as { prefs: { audioLang: string } }).prefs.audioLang = '';
        this.captionVersion++;
        this.captionTarget = undefined;
        // Invalidate subtitle loads from the previous title before new tracks arrive.
        void super.setCaptionTrack(null);
      }),
      this.on('onError', error => {
        if (!error.fatal) return;
        this.cancelStartup();
        void Promise.resolve().then(() => this.checkPlaybackRecovery());
      }),
      this.on('onStateChange', state => {
        if (state === PlayerState.ENDED || (state === PlayerState.PAUSED && typeof document !== 'undefined' && document.hidden)) {
          this.markPlaybackPaused();
        }
      }),
      this.on('onSeek', ({ to }) => {
        const recovery = this.recovery;
        if (!recovery) return;
        recovery.position = to;
        recovery.mode = recovery.mode === 'play' || !this.video.paused ? 'play' : 'seek';
        recovery.lastProgressAt = Date.now();
        if (recovery.retryFrom !== null) recovery.retryFrom = to;
      }),
      this.on('onAudioTracksChange', () => this.scheduleRestore()),
      this.on('onCaptionsTrackListChanged', () => {
        // The SDK restores language-only preferences immediately after this event.
        this.ignoreSdkCaptionRestore = true;
        Promise.resolve().then(() => { this.ignoreSdkCaptionRestore = false; });
        this.scheduleRestore();
      }),
    ];
  }

  play(): Promise<void> {
    if (this.error.peek()?.fatal) return Promise.resolve();
    const recovery = this.recovery;
    if (recovery) {
      const now = Date.now();
      if (recovery.pausedAt !== null && now - recovery.pausedAt >= IDLE_REOPEN_MS) {
        return this.reopenPlayback(recovery, 'play');
      }
      if (recovery.lastProgressAt === null || recovery.mode !== 'play') recovery.lastProgressAt = now;
      recovery.mode = 'play';
      recovery.pausedAt = null;
    }
    const source = this.source.peek();
    const kind = source?.metadata?.kind;
    if (this.startupComplete || this.engineName.peek() !== 'hls.js' || source?.live || (kind !== 'vod' && kind !== 'series')) {
      this.cancelStartup();
      return super.play();
    }
    if (this.startup) return this.startup.pending;
    const abort = new AbortController();
    const pending = waitForStartupBuffer(this.video, this.currentTime.peek(), abort.signal).then(() => {
      if (this.startup?.abort !== abort) return;
      this.startup = null;
      if (this.engineName.peek() !== 'hls.js') return;
      this.startupComplete = true;
      return super.play();
    });
    this.startup = { abort, pending };
    return pending;
  }

  private cancelStartup(): void {
    const startup = this.startup;
    this.startup = null;
    startup?.abort.abort();
  }

  pause(): void {
    this.markPlaybackPaused();
    this.cancelStartup();
    super.pause();
  }

  stop(): void {
    this.recovery = null;
    this.cancelStartup();
    super.stop();
  }

  private markPlaybackPaused(): void {
    const recovery = this.recovery;
    if (!recovery) return;
    const time = this.video.currentTime;
    if (recovery.mode === 'play' && !this.video.seeking && Number.isFinite(time) && time > recovery.position) {
      recovery.position = time;
    }
    recovery.pausedAt ??= Date.now();
    recovery.lastProgressAt = null;
    recovery.mode = null;
  }

  checkPlaybackRecovery(): void {
    const recovery = this.recovery;
    if (!recovery?.mode || recovery.lastProgressAt === null || this.source.peek() !== recovery.source || this.video.ended) return;
    const { mode } = recovery;
    const error = this.error.peek();
    const now = Date.now();
    if (error?.fatal) {
      recovery.lastProgressAt = null;
      if (recovery.retryFrom !== null || error.code !== 'network' || error.status === 401 || error.status === 403) return;
    } else {
      const state = this.state.peek();
      const time = this.video.currentTime;
      if (mode === 'seek' && !this.video.seeking && this.video.readyState >= 2 && Math.abs(time - recovery.position) < 1) {
        recovery.mode = null;
        recovery.lastProgressAt = null;
        return;
      }
      if (mode === 'play' && (state === PlayerState.PLAYING || state === PlayerState.BUFFERING) && !this.video.paused && !this.video.seeking
          && Number.isFinite(time) && time > recovery.position + 0.05) {
        recovery.position = time;
        recovery.lastProgressAt = now;
        if (recovery.retryFrom !== null && time >= recovery.retryFrom + 5) recovery.retryFrom = null;
        return;
      }
      if (now - recovery.lastProgressAt < (mode === 'seek' ? SEEK_STALL_MS : PLAYBACK_STALL_MS)) return;
      recovery.lastProgressAt = null;
      if (recovery.retryFrom !== null) {
        this.pause();
        this.error.value = { code: 'network', message: t('player.stalled'), fatal: true };
        return;
      }
    }
    void this.reopenPlayback(recovery, mode);
  }

  private reopenPlayback(recovery: PlaybackRecovery, mode: RecoveryMode): Promise<void> {
    // Open the original Xtream URL to get a fresh lease without changing the selected episode.
    this.automaticRetry = mode;
    try {
      return mode === 'play' ? this.load(recovery.source, recovery.position) : this.cue(recovery.source, recovery.position);
    } finally {
      this.automaticRetry = null;
    }
  }

  retryPlayback(): Promise<void> {
    const source = this.source.peek();
    if (!source) return Promise.resolve();
    return this.load(source, this.recovery?.position ?? (this.video.currentTime || undefined));
  }

  private saveChoices(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.choices)); } catch { /* Keep the in-memory preference when storage is unavailable. */ }
  }

  async playVideoAt(index: number, startTime?: number): Promise<void> {
    const request = ++this.episodeRequest;
    this.episodeAbort?.abort();
    this.episodeAbort = null;
    const source = this.playlist.peek()[index];
    if (source?.metadata?.kind === 'series' && !source.metadata.tracksProbed) {
      const abort = source.metadata.nativeContainer === 'mkv' ? null : new AbortController();
      this.episodeAbort = abort;
      const prepared = await vodSource(source.url, source, abort?.signal);
      if (request !== this.episodeRequest || this.playlist.peek()[index] !== source) return;
      const list = this.playlist.peek().slice();
      list[index] = prepared;
      this.playlist.value = list;
    }
    return super.playVideoAt(index, startTime);
  }

  setAudioTrack(id: string): void {
    const track = this.audioTracks.peek().find(track => track.id === id);
    if (!track) return;
    this.choices.audio = choice(track);
    this.saveChoices();
    super.setAudioTrack(id);
  }

  async setCaptionTrack(id: string | null): Promise<void> {
    if (this.ignoreSdkCaptionRestore) return;
    const track = this.captionTracks.peek().find(track => track.id === id);
    if (id !== null && !track) return;
    this.captionVersion++;
    this.captionTarget = id;
    this.choices.captions = track ? choice(track) : 'off';
    this.saveChoices();
    await super.setCaptionTrack(id);
  }

  private scheduleRestore(): void {
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    // Apply after the SDK has finished its engine-start defaults, including late track discovery.
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = null;
      const tracks = this.audioTracks.peek();
      const audio = preferred(tracks, this.choices.audio) || tracks.find(track => track.isDefault) || tracks[0];
      if (audio && this.audioTrack.peek()?.id !== audio.id) super.setAudioTrack(audio.id);
      void this.restoreCaptionsChoice();
    }, 0);
  }

  private async restoreCaptionsChoice(): Promise<void> {
    const tracks = this.captionTracks.peek() as Array<CaptionTrack & { isDefault?: boolean }>;
    const fallback = tracks.find(track => track.isDefault);
    const selected = this.choices.captions === 'off' ? undefined : preferred(tracks, this.choices.captions) || fallback;
    const id = selected?.id || null;
    if (this.captionTarget === id) return;
    this.captionTarget = id;
    const version = this.captionVersion;
    await super.setCaptionTrack(id);
    if (version === this.captionVersion && selected && !this.captionTrack.peek()) {
      await super.setCaptionTrack(fallback && fallback.id !== id ? fallback.id : null);
    }
  }

  destroy(): void {
    this.recovery = null;
    this.cancelStartup();
    this.episodeRequest++;
    this.episodeAbort?.abort();
    this.captionVersion++;
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    for (const off of this.preferenceCleanups) off();
    super.destroy();
  }
}
