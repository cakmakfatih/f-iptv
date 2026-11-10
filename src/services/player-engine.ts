import { NativeEngine, HlsJsEngine, canPlayNativeHls, hasHlsJs, type EngineFactory, type EngineCallbacks, type VideoSource, type CaptionTrack, type AudioTrack } from 'zapkit-tv/player';
import { t, type Key } from '../i18n';
import { captionText, hlsRenditions, readTrackText, trackLabel, trackLanguage, type Rendition, type TrackNames } from './player-tracks';

function names(): TrackNames {
  const languages: Record<string, string> = {};
  for (const lang of ['tr', 'en', 'fr', 'pt', 'es', 'de', 'it', 'ru', 'ar', 'ja', 'ko', 'zh']) {
    languages[lang] = t(('player.language.' + lang) as Key);
  }
  return { original: t('player.original'), audio: t('player.audio'), captions: t('player.captions'), languages };
}

function renditionHint(track: { lang: string }, index: number, count: number, hints: Rendition[]): Rendition | undefined {
  const language = trackLanguage(track.lang);
  const matching = language ? hints.filter(h => h.lang === language) : [];
  return matching.length === 1 ? matching[0] : count === hints.length ? hints[index] : undefined;
}

function localizedCallbacks(cb: EngineCallbacks, hints: Rendition[], captionHints: Rendition[] = []): EngineCallbacks {
  let tracks: AudioTrack[] = [];
  return {
    ...cb,
    audioTracks: incoming => {
      tracks = incoming.map((track, i) => {
        const hint = renditionHint(track, i, incoming.length, hints);
        return { ...track, label: trackLabel(track, 'audio', names(), i, hint), isDefault: hint?.isDefault ?? track.isDefault };
      });
      cb.audioTracks(tracks);
    },
    audioTrack: track => cb.audioTrack(track ? tracks.find(t => t.id === track.id) || { ...track, label: trackLabel(track, 'audio', names(), 0) } : null),
    captionTracks: tracks => cb.captionTracks(tracks.map((track, i) => ({
      ...track, label: trackLabel(track, 'captions', names(), i),
      isDefault: (track as CaptionTrack & { isDefault?: boolean }).isDefault ?? renditionHint(track, i, tracks.length, captionHints)?.isDefault,
    }))),
  };
}

/** Native decoding stays on the TV; manifest subtitles use the SDK's caption renderer. */
class TvNativeEngine extends NativeEngine {
  private trackAbort = new AbortController();
  private subtitles: Rendition[] = [];
  private captionCache = new Map<string, Promise<string>>();
  private master = '';

  async load(video: HTMLVideoElement, source: VideoSource, startTime: number | undefined, cb: EngineCallbacks): Promise<void> {
    const hints = source.metadata?.hlsTracks as ReturnType<typeof hlsRenditions> | undefined;
    this.master = source.url;
    this.subtitles = source.live ? [] : hints?.captions || [];
    const localized = localizedCallbacks(cb, hints?.audio || [], hints?.captions || []);
    const manifest: CaptionTrack[] = this.subtitles.map((track, i) => ({
      id: `hls-caption:${i}`, lang: track.lang, label: trackLabel(track, 'captions', names(), i), kind: 'subtitles', origin: 'manifest', isDefault: track.isDefault,
    }));
    const captionTracks = (native: CaptionTrack[]) => localized.captionTracks([
      ...manifest,
      ...native.filter(track => !this.subtitles.some(hint => hint.lang && hint.lang === trackLanguage(track.lang))),
    ]);
    await super.load(video, source, startTime, { ...localized, captionTracks });
    if (manifest.length) captionTracks([]);
  }

  async loadCaptionTrack(id: string): Promise<string> {
    if (!id.startsWith('hls-caption:')) return super.loadCaptionTrack(id);
    let pending = this.captionCache.get(id);
    if (!pending) {
      pending = this.loadManifestCaption(Number(id.slice(12)));
      this.captionCache.set(id, pending);
      pending.catch(() => this.captionCache.delete(id));
    }
    return pending;
  }

  private async loadManifestCaption(index: number): Promise<string> {
    const track = this.subtitles[index];
    if (!track) throw new Error('Subtitle track is unavailable');
    // Refresh only on selection: authenticated manifest URLs can expire during playback.
    const response = await readTrackText(this.master, this.trackAbort.signal);
    const current = hlsRenditions(response.body, response.url).captions;
    const fresh = current.find(t => t.lang === track.lang && t.label === track.label) || current[index];
    if (!fresh) throw new Error('Subtitle track is unavailable');
    return captionText(fresh.url, this.trackAbort.signal);
  }

  destroy(): void {
    this.trackAbort.abort();
    this.captionCache.clear();
    super.destroy();
  }
}

class LocalizedHlsEngine extends HlsJsEngine {
  async load(video: HTMLVideoElement, source: VideoSource, startTime: number | undefined, cb: EngineCallbacks): Promise<void> {
    const hints = source.metadata?.hlsTracks as ReturnType<typeof hlsRenditions> | undefined;
    return super.load(video, source, startTime, localizedCallbacks(cb, hints?.audio || [], hints?.captions || []));
  }
}

export const playerEngine: EngineFactory = (source, video) => {
  const path = source.url.split(/[?#]/)[0].toLowerCase();
  const type = source.type && source.type !== 'auto' ? source.type : /\.mpd$/.test(path) ? 'dash' : /\.m3u8?$/.test(path) ? 'hls' : 'progressive';
  if (type === 'dash') return null;
  if (type === 'hls' && !canPlayNativeHls(video)) return hasHlsJs() ? new LocalizedHlsEngine() : null;
  return new TvNativeEngine();
};
