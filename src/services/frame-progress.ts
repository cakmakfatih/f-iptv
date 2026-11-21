type FrameSample = { displayed: number; time: number; at: number };

export class FrameProgress {
  private previous?: FrameSample;

  reset(): void { this.previous = undefined; }

  sample(video: HTMLVideoElement, now: number): { advancing: boolean; frozenAt: number | null } | undefined {
    const time = video.currentTime;
    if (video.paused || video.seeking || video.ownerDocument?.hidden || !video.videoWidth || !Number.isFinite(time)) {
      this.reset();
      return;
    }

    const quality = video.getVideoPlaybackQuality?.();
    const legacy = video as HTMLVideoElement & { webkitDecodedFrameCount?: number; webkitDroppedFrameCount?: number };
    const displayed = quality?.totalVideoFrames
      ? quality.totalVideoFrames - quality.droppedVideoFrames
      : (legacy.webkitDecodedFrameCount ?? 0) - (legacy.webkitDroppedFrameCount ?? 0);
    if (!Number.isFinite(displayed) || displayed <= 0) {
      this.reset();
      return;
    }

    const previous = this.previous;
    if (!previous || displayed !== previous.displayed || time < previous.time) {
      this.previous = { displayed, time, at: now };
      return { advancing: true, frozenAt: null };
    }

    // Audio can advance the media clock while the video decoder outputs no frames.
    const frozenAt = now - previous.at >= 6000 && time - previous.time >= 2 ? previous.time : null;
    return { advancing: false, frozenAt };
  }
}
