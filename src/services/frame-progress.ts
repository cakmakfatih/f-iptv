type FrameSample = { displayed: number; time: number; at: number; presentation: boolean };

export class FrameProgress {
  private previous?: FrameSample;
  private presented?: { count: number; time: number };
  private callback?: { video: HTMLVideoElement; id: number; time: number; at: number };
  private driftStartedAt?: number;

  reset(): void {
    if (this.callback) this.callback.video.cancelVideoFrameCallback?.(this.callback.id);
    this.callback = undefined;
    this.previous = undefined;
    this.presented = undefined;
    this.driftStartedAt = undefined;
  }

  sample(video: HTMLVideoElement, now: number): { advancing: boolean; frozenAt: number | null } | undefined {
    const time = video.currentTime;
    if (video.paused || video.seeking || video.ownerDocument?.hidden || !video.videoWidth || !Number.isFinite(time)) {
      this.reset();
      return;
    }

    if (!this.callback && typeof video.requestVideoFrameCallback === 'function') {
      const id = video.requestVideoFrameCallback((_now, frame) => {
        if (this.callback?.video !== video || this.callback.id !== id) return;
        this.callback = undefined;
        this.presented = { count: frame.presentedFrames, time: frame.mediaTime };
      });
      this.callback = { video, id, time, at: now };
    }
    const presentation = this.presented;
    const pending = this.callback;
    if (!presentation && pending && now - pending.at >= 700 && time - pending.time >= 0.8 &&
        video.getClientRects().length > 0) {
      return { advancing: false, frozenAt: pending.time };
    }
    const quality = presentation ? undefined : video.getVideoPlaybackQuality?.();
    const legacy = video as HTMLVideoElement & { webkitDecodedFrameCount?: number; webkitDroppedFrameCount?: number };
    const displayed = presentation?.count ?? (quality?.totalVideoFrames
      ? quality.totalVideoFrames - quality.droppedVideoFrames
      : (legacy.webkitDecodedFrameCount ?? 0) - (legacy.webkitDroppedFrameCount ?? 0));
    if (!Number.isFinite(displayed) || displayed <= 0) {
      return;
    }

    const previous = this.previous;
    const lastFrameTime = presentation?.time ?? time;
    const advancing = !previous || displayed !== previous.displayed || time < previous.time ||
      previous.presentation !== Boolean(presentation);
    if (advancing) this.previous = { displayed, time: lastFrameTime, at: now, presentation: Boolean(presentation) };

    // A frame can still be presented while the audio clock pulls ahead of it.
    if (presentation && Math.abs(time - presentation.time) >= 0.8) {
      this.driftStartedAt ??= now;
      if (now - this.driftStartedAt >= 250) return { advancing: false, frozenAt: presentation.time };
    } else {
      this.driftStartedAt = undefined;
    }

    const frozenAt = !advancing && previous && now - previous.at >= 700 && time - previous.time >= 0.8 ? previous.time : null;
    return { advancing, frozenAt };
  }
}
