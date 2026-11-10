import { Player, loadPrefs, type PlayerOptions, type CaptionTrack } from 'zapkit-tv/player';
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

/** Track identities persist across titles; automatic fallbacks never replace the viewer's choice. */
export class RememberingPlayer extends Player {
  private choices = readPreferences();
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private ignoreSdkCaptionRestore = false;
  private captionTarget: string | null | undefined;
  private captionVersion = 0;
  private episodeRequest = 0;
  private preferenceCleanups: Array<() => void>;

  constructor(options: PlayerOptions = {}) {
    super(options);
    this.preferenceCleanups = [
      this.on('onVideoDataChange', () => {
        this.captionVersion++;
        this.captionTarget = undefined;
        // Invalidate subtitle loads from the previous title before new tracks arrive.
        void super.setCaptionTrack(null);
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

  private saveChoices(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.choices)); } catch { /* Keep the in-memory preference when storage is unavailable. */ }
  }

  async playVideoAt(index: number, startTime?: number): Promise<void> {
    const request = ++this.episodeRequest;
    const source = this.playlist.peek()[index];
    if (source?.metadata?.kind === 'series' && !source.metadata.tracksProbed) {
      const prepared = await vodSource(source.url, source);
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
    this.episodeRequest++;
    this.captionVersion++;
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    for (const off of this.preferenceCleanups) off();
    super.destroy();
  }
}
