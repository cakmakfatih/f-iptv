import { Player, PlayerState, loadPrefs, type PlayerOptions, type PlayerErrorInfo, type CaptionTrack, type VideoSource } from 'zapkit-tv/player';
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
const LIVE_STALL_MS = 8000;
const LIVE_STARTUP_STALL_MS = 20000;
const RETRY_WINDOW_MS = 30000;
const RETRY_DELAY_MS = 2000;
const RETRY_STALL_MS = 10000;
const IDLE_REOPEN_MS = 45000;

type RecoveryMode = 'play' | 'seek';

interface PlaybackRecovery {
  source: VideoSource;
  position: number;
  lastProgressAt: number | null;
  mode: RecoveryMode | null;
  pausedAt: number | null;
  retry: { deadline: number; nextAt: number | null; progressFrom: number | null; error?: PlayerErrorInfo } | null;
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
        this.recovery = source && (source.live || kind === 'series' || kind === 'vod')
          ? { source, position, mode: null, lastProgressAt: null, pausedAt: null, retry: null }
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
        const recovery = this.recovery;
        if (!recovery || this.source.peek() !== recovery.source || (!recovery.mode && recovery.pausedAt !== null)) return;
        recovery.mode ??= 'play';
        const now = Date.now();
        recovery.retry ??= { deadline: now + RETRY_WINDOW_MS, nextAt: null, progressFrom: null };
        recovery.retry.error = error;
        if (now >= recovery.retry.deadline) {
          this.finishPlaybackRecovery(recovery);
          return;
        }
        recovery.retry.nextAt ??= now + RETRY_DELAY_MS;
        this.error.value = null;
        // The SDK publishes its fatal state immediately after this event.
        void Promise.resolve().then(() => {
          if (this.recovery === recovery && recovery.retry?.nextAt != null) this.state.value = PlayerState.BUFFERING;
        });
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
        if (recovery.retry) recovery.retry.progressFrom = null;
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
      if (!recovery.source.live && recovery.pausedAt !== null && now - recovery.pausedAt >= IDLE_REOPEN_MS) {
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
    recovery.retry = null;
  }

  checkPlaybackRecovery(): void {
    const recovery = this.recovery;
    if (!recovery?.mode || this.source.peek() !== recovery.source || this.video.ended) return;
    const { mode } = recovery;
    const now = Date.now();
    const retry = recovery.retry;
    if (retry?.nextAt != null) {
      if (now >= retry.deadline) this.finishPlaybackRecovery(recovery);
      else if (now >= retry.nextAt) void this.reopenPlayback(recovery, mode);
      return;
    }
    if (recovery.lastProgressAt === null) return;
    const state = this.state.peek();
    const time = this.video.currentTime;
    if (mode === 'seek' && !this.video.seeking && this.video.readyState >= 2 && Math.abs(time - recovery.position) < 1) {
      recovery.mode = null;
      recovery.lastProgressAt = null;
      recovery.retry = null;
      return;
    }
    if (mode === 'play' && (state === PlayerState.PLAYING || state === PlayerState.BUFFERING) && !this.video.paused && !this.video.seeking
        && Number.isFinite(time) && time > recovery.position + 0.05) {
      recovery.position = time;
      recovery.lastProgressAt = now;
      if (retry) {
        retry.progressFrom ??= time;
        if (time >= retry.progressFrom + 5) recovery.retry = null;
      }
      return;
    }
    if (retry && now >= retry.deadline) {
      this.finishPlaybackRecovery(recovery);
      return;
    }
    const playbackLimit = recovery.source.live
      ? recovery.position > 0 ? LIVE_STALL_MS : LIVE_STARTUP_STALL_MS
      : PLAYBACK_STALL_MS;
    const stallLimit = retry ? RETRY_STALL_MS : mode === 'seek' ? SEEK_STALL_MS : playbackLimit;
    if (now - recovery.lastProgressAt < stallLimit) return;
    recovery.retry ??= { deadline: now + RETRY_WINDOW_MS, nextAt: null, progressFrom: null };
    void this.reopenPlayback(recovery, mode);
  }

  private finishPlaybackRecovery(recovery: PlaybackRecovery): void {
    const error: PlayerErrorInfo = recovery.retry?.error ?? { code: 'network', message: t('player.stalled'), fatal: true };
    this.pause();
    this.error.value = error;
  }

  private reopenPlayback(recovery: PlaybackRecovery, mode: RecoveryMode): Promise<void> {
    const now = Date.now();
    const position = recovery.source.live ? 0 : recovery.position;
    const retry = recovery.retry && { ...recovery.retry, nextAt: null, progressFrom: null };
    this.recovery = { ...recovery, position, mode, lastProgressAt: now, retry, pausedAt: mode === 'seek' ? now : null };
    this.cancelStartup();
    // Reopening an existing title does not need the extra first-play buffer.
    this.startupComplete = true;
    (this as unknown as { prefs: { audioLang: string } }).prefs.audioLang = '';
    this.captionVersion++;
    this.captionTarget = undefined;
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
    return this.reloadSource(position, mode === 'play');
  }

  retryPlayback(): Promise<void> {
    const source = this.source.peek();
    if (!source) return Promise.resolve();
    if (this.recovery?.source === source) {
      this.recovery.retry = null;
      return this.reopenPlayback(this.recovery, 'play');
    }
    return this.load(source, this.video.currentTime || undefined);
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
