import type Shaka from 'shaka-player';
import { canPlayNativeHls, type Engine, type EngineCallbacks, type PlayerErrorInfo, type QualityLevel, type VideoSource, type VttCue } from 'zapkit-tv/player';
import { isLegacyTv } from './device';

type Runtime = typeof Shaka;
type Variant = Shaka.extern.Track;
type Audio = Shaka.extern.AudioTrack;

let runtime: Promise<Runtime> | undefined;
const loadRuntime = () => runtime ??= import('shaka-player/dist/shaka-player.compiled.js').then(({ default: shaka }) => {
  shaka.polyfill.installAll();
  return shaka;
}).catch(error => {
  runtime = undefined;
  throw error;
});

export const SHAKA_CAPTIONS_CHANGED = 'shakacaptionschanged';
export const activeShakaEngines = new WeakMap<HTMLVideoElement, ShakaEngine>();
const detaching = new WeakMap<HTMLVideoElement, Promise<void>>();
export const pendingShakaDetach = (video: HTMLVideoElement) => detaching.get(video);

const qualityId = (track: Variant) => String(track.videoId ?? track.id);
const audioId = (track: Audio) => JSON.stringify([track.originalLanguage ?? track.language, track.label, track.roles, track.channelsCount, track.codecs]);

function audioMatches(variant: Variant, audio: Audio): boolean {
  return variant.language === audio.language && variant.label === audio.label &&
    variant.channelsCount === audio.channelsCount && variant.audioCodec === audio.codecs &&
    (variant.audioRoles ?? []).join(',') === audio.roles.join(',');
}

function cueText(cue: Shaka.text.Cue): string {
  if (cue.lineBreak) return '\n';
  let text = cue.nestedCues.length ? cue.nestedCues.map(cueText).join('') : cue.payload.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (cue.fontStyle === 'italic') text = `<i>${text}</i>`;
  if (cue.fontWeight >= 700) text = `<b>${text}</b>`;
  if (cue.textDecoration.some(value => value === 'underline')) text = `<u>${text}</u>`;
  return text;
}

class CaptionBuffer implements Shaka.extern.TextDisplayer {
  private visible = false;
  private cues = new Map<string, VttCue>();
  constructor(private changed: (cues: VttCue[]) => void) {}

  append(cues: Shaka.text.Cue[]): void {
    this.collect(cues);
    this.publish();
  }

  private collect(cues: Shaka.text.Cue[]): void {
    for (const cue of cues) {
      if (cue.isContainer) {
        this.collect(cue.nestedCues);
        continue;
      }
      const text = cueText(cue);
      if (!text || cue.startTime >= cue.endTime) continue;
      const id = JSON.stringify([cue.startTime, cue.endTime, text]);
      this.cues.set(id, { id, start: cue.startTime, end: cue.endTime, text, settings: {} });
    }
  }

  remove(start: number, end: number): boolean {
    let removed = false;
    for (const [id, cue] of this.cues) {
      if (cue.end <= start || cue.start >= end) continue;
      this.cues.delete(id);
      removed = true;
    }
    if (removed) this.publish();
    return true;
  }

  configure(): void {}
  enableTextDisplayer(): void {}
  setTextLanguage(): void {}
  isTextVisible(): boolean { return this.visible; }
  setTextVisibility(on: boolean): void { this.visible = on; }
  async destroy(): Promise<void> { this.cues.clear(); }
  private publish(): void { this.changed(Array.from(this.cues.values()).sort((a, b) => a.start - b.start || a.end - b.end)); }
}

export class ShakaEngine implements Engine {
  readonly name = 'shaka';
  private player?: Shaka.Player;
  private video?: HTMLVideoElement;
  private native?: Engine;
  private destroyed = false;
  private manualQuality = 'auto';
  private captionBuffer?: CaptionBuffer;
  captionCues: VttCue[] = [];

  constructor(private nativeHls: () => Engine, private getRuntime: () => Promise<Runtime> = loadRuntime) {}

  get usingNative(): boolean { return !!this.native; }

  async load(video: HTMLVideoElement, source: VideoSource, startTime: number | undefined, cb: EngineCallbacks): Promise<void> {
    this.video = video;
    activeShakaEngines.set(video, this);
    const shaka = await this.getRuntime();
    const pending = pendingShakaDetach(video);
    if (pending) await pending;
    if (this.destroyed) return;
    const mse = typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function';
    if (!mse || !shaka.Player.isBrowserSupported()) {
      await this.loadNative(video, source, startTime, cb);
      return;
    }

    const player = new shaka.Player();
    this.player = player;
    const errorType = shaka.util.Error;
    const retry = { maxAttempts: 3, baseDelay: 500, connectionTimeout: 8000, stallTimeout: 6000, timeout: 18000 };
    const streaming = {
      preferNativeHls: false,
      useNativeHlsForFairPlay: false,
      retryParameters: retry,
      lowLatencyMode: false,
      ...(source.live && {
        bufferingGoal: 22, rebufferingGoal: 5, bufferBehind: isLegacyTv ? 15 : 30,
        stallEnabled: false,
        liveSync: { enabled: false },
      }),
    };
    player.configure({
      manifest: { retryParameters: retry },
      streaming,
      textDisplayFactory: () => {
        const display = new CaptionBuffer(cues => {
          if (this.captionBuffer !== display || this.destroyed) return;
          this.captionCues = cues;
          video.dispatchEvent(new Event(SHAKA_CAPTIONS_CHANGED));
        });
        this.captionBuffer = display;
        return display;
      },
    });
    const network = shaka.net.NetworkingEngine.RequestType;
    const headers = source.headers;
    if (headers) player.getNetworkingEngine()?.registerRequestFilter((type, request) => {
      if (type === network.MANIFEST || type === network.SEGMENT || type === network.KEY) Object.assign(request.headers, headers);
    });

    const reportTracks = () => {
      const variants = player.getVariantTracks();
      const levels = new Map<string, QualityLevel>();
      for (const track of variants) {
        const id = qualityId(track);
        if (levels.has(id)) continue;
        const bitrate = track.videoBandwidth ?? track.bandwidth;
        levels.set(id, {
          id, height: track.height ?? 0, width: track.width ?? 0, bitrate,
          label: track.height ? `${track.height}p${track.frameRate && track.frameRate > 30 ? Math.round(track.frameRate) : ''}` : `${Math.round(bitrate / 1000)}k`,
          codecs: track.codecs ?? undefined, frameRate: track.frameRate ?? undefined,
        });
      }
      const active = variants.find(track => track.active);
      cb.qualities(Array.from(levels.values()));
      cb.quality(active ? levels.get(qualityId(active)) ?? null : null);
      const audio = player.getAudioTracks().map(track => ({
        id: audioId(track), lang: track.originalLanguage ?? track.language, label: track.label ?? '', isDefault: track.primary,
        active: track.active,
      }));
      cb.audioTracks(audio);
      cb.audioTrack(audio.find(track => track.active) ?? null);
    };
    const reportCaptions = () => cb.captionTracks(player.getTextTracks().map(track => ({
      id: `shaka:${track.id}`, lang: track.originalLanguage ?? track.language, label: track.label ?? '',
      kind: track.kind === 'caption' ? 'captions' : 'subtitles', origin: 'manifest',
    })));
    const describeError = (error: Shaka.util.Error): PlayerErrorInfo => {
      const category = errorType.Category;
      const code = error.category === category.NETWORK ? 'network' : error.category === category.MEDIA ? 'decode' : error.category === category.MANIFEST ? 'manifest' : error.category === category.DRM ? 'drm' : 'unknown';
      return { code, message: `Shaka ${error.code}`, fatal: true, status: error.code === errorType.Code.BAD_HTTP_STATUS ? Number(error.data[1]) || undefined : undefined };
    };

    try {
      await player.attach(video);
      if (this.destroyed) return;
      await player.load(source.url, source.live ? undefined : startTime, 'application/x-mpegurl');
    } catch (error) {
      if (this.destroyed) return;
      const shakaError = error as Shaka.util.Error;
      if (shakaError.code === errorType.Code.CONTENT_UNSUPPORTED_BY_BROWSER && canPlayNativeHls(video)) {
        await this.detach();
        if (!this.destroyed) await this.loadNative(video, source, startTime, cb);
        return;
      }
      if (typeof shakaError.code === 'number') {
        const failure = describeError(shakaError);
        throw Object.assign(new Error(failure.message), { code: failure.code });
      }
      throw error;
    }
    if (this.destroyed) return;
    player.addEventListener('error', event => {
      const error = (event as CustomEvent<Shaka.util.Error>).detail;
      if (!this.destroyed && error.severity === errorType.Severity.CRITICAL) cb.error(describeError(error));
    });
    for (const event of ['adaptation', 'variantchanged', 'trackschanged']) player.addEventListener(event, reportTracks);
    player.addEventListener('trackschanged', reportCaptions);
    reportTracks();
    reportCaptions();
  }

  private async loadNative(video: HTMLVideoElement, source: VideoSource, startTime: number | undefined, cb: EngineCallbacks): Promise<void> {
    if (!canPlayNativeHls(video)) throw Object.assign(new Error('HLS playback is unsupported'), { code: 'unsupported' });
    this.native = this.nativeHls();
    await this.native.load(video, source, startTime, cb);
  }

  setQuality(id: string): void {
    if (this.native) return this.native.setQuality(id);
    const player = this.player;
    if (!player) return;
    if (id === 'auto') {
      this.manualQuality = id;
      player.configure('abr.enabled', true);
      return;
    }
    const candidates = player.getVariantTracks().filter(track => qualityId(track) === id);
    const audio = player.getAudioTracks().find(track => track.active);
    const selected = audio ? candidates.find(track => audioMatches(track, audio)) ?? candidates[0] : candidates[0];
    if (!selected) return;
    this.manualQuality = id;
    player.configure('abr.enabled', false);
    if (!selected.active) player.selectVariantTrack(selected, true, 4);
  }

  setQualityRange(min: number, max: number): void {
    if (this.native) return this.native.setQualityRange(min, max);
    this.player?.configure({ abr: { restrictions: { minHeight: min || 0, maxHeight: max || Infinity } } });
  }

  setAudioTrack(id: string): void {
    if (this.native) return this.native.setAudioTrack(id);
    const player = this.player;
    const audio = player?.getAudioTracks().find(track => audioId(track) === id);
    if (!player || !audio || audio.active) return;
    const matching = player.getVariantTracks().find(track => qualityId(track) === this.manualQuality && audioMatches(track, audio));
    if (matching) player.selectVariantTrack(matching, true, 2);
    else player.selectAudioTrack(audio, 2);
  }

  async loadCaptionTrack(id: string): Promise<string> {
    if (this.native?.loadCaptionTrack) return this.native.loadCaptionTrack(id);
    const player = this.player;
    const track = player?.getTextTracks().find(track => `shaka:${track.id}` === id);
    if (!player || !track) throw new Error('Subtitle track is unavailable');
    if (!track.active) {
      this.captionBuffer?.remove(-Infinity, Infinity);
      player.selectTextTrack(track);
    }
    player.setTextTrackVisibility(true);
    return 'WEBVTT\n';
  }

  hideCaptions(): void {
    this.player?.setTextTrackVisibility(false);
  }

  isLive(): boolean { return this.native?.isLive() ?? this.player?.isLive() ?? false; }
  seekableRange() { return this.native?.seekableRange() ?? this.player?.seekRange() ?? null; }
  liveEdge() { return this.native?.liveEdge() ?? (this.isLive() ? this.seekableRange()?.end ?? null : null); }

  stats() {
    if (this.native) return this.native.stats();
    const stats = this.player?.getStats();
    return { bandwidth: stats?.estimatedBandwidth || 0, bitrate: stats?.streamBandwidth || 0,
      codecs: stats?.currentCodecs || '', liveLatency: this.isLive() && Number.isFinite(stats?.liveLatency) ? stats!.liveLatency : null };
  }

  private detach(): Promise<void> {
    const player = this.player;
    const video = this.video;
    this.player = undefined;
    if (!player || !video) return (video && pendingShakaDetach(video)) ?? Promise.resolve();
    const pending = player.destroy().catch(() => {}).finally(() => {
      if (detaching.get(video) === pending) detaching.delete(video);
    });
    detaching.set(video, pending);
    return pending;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.video && activeShakaEngines.get(this.video) === this) activeShakaEngines.delete(this.video);
    this.native?.destroy();
    void this.detach();
    this.video = undefined;
    this.captionCues = [];
    this.captionBuffer = undefined;
  }
}
