import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const data = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)),
} });
const bundle = await build({ entryPoints: ['src/services/remembering-player.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { RememberingPlayer } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const settle = () => new Promise(resolve => setTimeout(resolve, 15));

function fixture(engineName = 'fixture') {
  let playCalls = 0;
  const starts = [];
  const video = Object.assign(new EventTarget(), {
    setAttribute() {}, removeAttribute() {}, load() {}, pause() {},
    play() { playCalls++; return Promise.resolve(); },
    paused: true, currentTime: 0, duration: 100, playbackRate: 1, volume: 1, muted: false,
    buffered: { length: 0 }, seekable: { length: 0 },
  });
  let callbacks;
  let activeAudio;
  const player = new RememberingPlayer({ video, pauseWhenHidden: false, gapJumping: false, engines: [() => ({
    name: engineName, async load(_video, source, _start, cb) {
      callbacks = cb;
      starts.push({ url: source.url, position: _start });
      cb.audioTracks(source.metadata.audio || []);
      activeAudio = source.metadata.audio?.find(track => track.isDefault) || source.metadata.audio?.[0] || null;
      cb.audioTrack(activeAudio);
      cb.captionTracks(source.metadata.captions || []);
    },
    setAudioTrack(id) { activeAudio = player.audioTracks.peek().find(track => track.id === id); callbacks.audioTrack(activeAudio); },
    async loadCaptionTrack() { return 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nCaption\n'; },
    destroy() {}, setQuality() {}, setQualityRange() {}, isLive: () => false, seekableRange: () => null,
  })] });
  return {
    player, video, starts, get playCalls() { return playCalls; }, get activeAudio() { return activeAudio; },
    async open(audio = [], captions = []) {
      await player.cue({ url: 'https://media.test/movie', metadata: { audio, captions } });
      await settle();
    },
    async announce(audio, captions) { callbacks.audioTracks(audio); callbacks.captionTracks(captions); await settle(); },
    fail(error) { callbacks.error(error); },
  };
}

test('a stalled resumed episode retries within a bounded window at the last played position', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture('native');
  const url = 'https://media.test/series/member/fixture/10.m3u8';
  try {
    await f.player.load({ url, type: 'hls', metadata: { kind: 'series' } }, 20);
    f.video.paused = false;
    f.video.dispatchEvent(new Event('playing'));
    f.video.currentTime = 32;
    f.player.checkPlaybackRecovery();
    f.player.pause();
    f.video.paused = true;
    context.mock.timers.tick(20000);
    f.player.checkPlaybackRecovery();
    assert.equal(f.starts.length, 1, 'pausing does not reopen the stream');

    await f.player.play();
    f.video.paused = false;
    f.video.dispatchEvent(new Event('playing'));
    f.video.currentTime = 44;
    f.player.checkPlaybackRecovery();
    f.video.dispatchEvent(new Event('waiting'));
    f.video.dispatchEvent(new Event('pause'));
    context.mock.timers.tick(4000);
    f.player.checkPlaybackRecovery();
    assert.equal(f.starts.length, 1, 'brief buffering does not reopen the stream');
    context.mock.timers.tick(26000);
    f.player.checkPlaybackRecovery();
    await Promise.resolve();
    assert.deepEqual(f.starts, [{ url, position: 20 }, { url, position: 44 }]);

    context.mock.timers.tick(10000);
    f.player.checkPlaybackRecovery();
    await Promise.resolve();
    assert.equal(f.starts.length, 3, 'another failure gets another attempt');
    assert.equal(f.player.error.peek(), null);

    context.mock.timers.tick(21000);
    f.player.checkPlaybackRecovery();
    assert.equal(f.starts.length, 3, 'an unsuccessful recovery stops after the retry window');
    assert.equal(f.player.error.peek()?.fatal, true, 'the retry panel can now open');
    await f.player.retryPlayback();
    assert.deepEqual(f.starts.at(-1), { url, position: 44 });
  } finally { f.player.destroy(); }
});

test('resuming after an extended pause opens a fresh session before playing stale buffered media', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture('native');
  const url = 'https://media.test/series/member/fixture/10.m3u8';
  try {
    let titleChanges = 0;
    f.player.on('onVideoDataChange', () => { titleChanges++; });
    await f.player.load({ url, type: 'hls', metadata: { kind: 'series' } }, 20);
    f.player.duration.value = 100;
    f.video.currentTime = 42;
    f.player.pause();
    context.mock.timers.tick(120000);
    await f.player.play();
    assert.deepEqual(f.starts, [{ url, position: 20 }, { url, position: 42 }]);
    assert.equal(titleChanges, 1);
    assert.equal(f.player.duration.peek(), 100);
  } finally { f.player.destroy(); }
});

test('a seek while paused renews the playlist at the target and shows Retry when still stalled', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture('native');
  const url = 'https://media.test/series/member/fixture/10.m3u8';
  try {
    await f.player.load({ url, type: 'hls', metadata: { kind: 'series' } }, 20);
    f.player.pause();
    f.video.readyState = 1;
    f.video.seeking = true;
    f.player.seekTo(60);
    f.video.dispatchEvent(new Event('pause'));
    context.mock.timers.tick(16000);
    f.player.checkPlaybackRecovery();
    await Promise.resolve();
    assert.deepEqual(f.starts.at(-1), { url, position: 60 });
    assert.equal(f.starts.length, 2);
    assert.equal(f.playCalls, 1, 'seeking keeps the video paused');
    context.mock.timers.tick(30000);
    f.player.checkPlaybackRecovery();
    assert.equal(f.player.error.peek()?.fatal, true);
    assert.equal(f.starts.length, 2);
    await f.player.retryPlayback();
    assert.equal(f.starts.at(-1).position, 60);
    assert.equal(f.playCalls, 2);
  } finally { f.player.destroy(); }
});

test('an expired segment and a refused session both retry before showing the panel', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture('native');
  const url = 'https://media.test/series/member/fixture/10.m3u8';
  try {
    await f.player.load({ url, type: 'hls', metadata: { kind: 'series' } }, 20);
    f.video.paused = false;
    f.video.dispatchEvent(new Event('playing'));
    f.video.currentTime = 42;
    f.player.checkPlaybackRecovery();

    f.fail({ code: 'network', status: 404, message: 'Expired media', fatal: true });
    assert.equal(f.player.error.peek(), null);
    context.mock.timers.tick(2000);
    f.player.checkPlaybackRecovery();
    await Promise.resolve();
    assert.deepEqual(f.starts.at(-1), { url, position: 42 });
    assert.equal(f.starts.length, 2);

    f.fail({ code: 'network', status: 403, message: 'Connection refused', fatal: true });
    assert.equal(f.player.error.peek(), null);
    context.mock.timers.tick(2000);
    f.player.checkPlaybackRecovery();
    await Promise.resolve();
    assert.equal(f.starts.length, 3);
    context.mock.timers.tick(29000);
    f.player.checkPlaybackRecovery();
    assert.equal(f.player.error.peek()?.status, 403);
  } finally { f.player.destroy(); }
});

test('a live stall retries at the live edge and a user pause cancels scheduled retries', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture('shaka');
  const url = 'https://media.test/live.m3u8';
  try {
    await f.player.load({ url, live: true, type: 'hls', metadata: { kind: 'live' } });
    f.video.paused = false;
    f.video.currentTime = 500;
    f.video.dispatchEvent(new Event('playing'));
    f.player.checkPlaybackRecovery();
    f.video.dispatchEvent(new Event('waiting'));

    context.mock.timers.tick(24000);
    f.player.checkPlaybackRecovery();
    assert.equal(f.starts.length, 1, 'a delayed live segment keeps the current session');

    context.mock.timers.tick(6000);
    f.player.checkPlaybackRecovery();
    await Promise.resolve();
    assert.equal(f.starts.length, 2);
    assert.equal(f.starts[1].position, 0, 'a new live session starts from the live edge');

    f.fail({ code: 'decode', message: 'Lost stream', fatal: true });
    assert.equal(f.player.error.peek(), null);
    f.player.pause();
    context.mock.timers.tick(35000);
    f.player.checkPlaybackRecovery();
    assert.equal(f.starts.length, 2);
  } finally { f.player.destroy(); }
});

function ranges(...pairs) {
  return { length: pairs.length, start: i => pairs[i][0], end: i => pairs[i][1] };
}

test('HLS episodes wait for a contiguous buffer at their resume point before autoplay', async () => {
  const f = fixture('shaka');
  try {
    await f.player.load({ url: 'https://media.test/episode.m3u8', type: 'hls', metadata: { kind: 'series' } }, 30);
    f.video.buffered = ranges([0, 8], [30, 32], [34, 39]);
    await new Promise(resolve => setTimeout(resolve, 160));
    assert.equal(f.playCalls, 0, 'other ranges cannot cover a gap at the resume point');
    f.video.buffered = ranges([0, 8], [30, 35.25]);
    await f.player.play();
    assert.equal(f.playCalls, 1);
    await f.player.play();
    assert.equal(f.playCalls, 2, 'later play requests do not wait for the startup buffer');
  } finally { f.player.destroy(); }
});

test('switching from an HLS episode to live cancels the pending VOD autoplay', async () => {
  const f = fixture('shaka');
  try {
    await f.player.load({ url: 'https://media.test/episode.m3u8', type: 'hls', metadata: { kind: 'series' } });
    const pending = f.player.play();
    await f.player.load({ url: 'https://media.test/live.m3u8', type: 'hls', live: true, metadata: { kind: 'live' } });
    await pending;
    assert.equal(f.playCalls, 1, 'only the live source starts, without waiting for a VOD buffer');
  } finally { f.player.destroy(); }
});

const audio = [
  { id: 'dub', lang: 'tr', label: 'Türkçe', isDefault: true },
  { id: 'original', lang: 'und', label: 'Orijinal' },
];
const captions = [
  { id: 'english', lang: 'en', label: 'English', kind: 'subtitles', origin: 'manifest', isDefault: true },
  { id: 'turkish', lang: 'tr', label: 'Turkish', kind: 'subtitles', origin: 'manifest' },
];

test('original audio and Turkish captions survive a new player and changed track IDs/languages', async () => {
  data.clear();
  const first = fixture();
  try {
    await first.open(audio, captions);
    first.player.setAudioTrack('original');
    await first.player.setCaptionTrack('turkish');
    first.player.setCaptionSettings({ fontScale: 1.5, color: '#ffff00', backgroundOpacity: 0.5, edge: 'outline' });
  } finally { first.player.destroy(); }
  const next = fixture();
  try {
    const changedAudio = [{ ...audio[0], id: 'new-dub' }, { ...audio[1], id: 'new-original', lang: 'en', label: 'Original' }];
    await next.open(changedAudio, captions.map(t => ({ ...t, id: 'new-' + t.id })));
    assert.equal(next.activeAudio.id, 'new-original');
    assert.equal(next.player.captionTrack.peek().id, 'new-turkish');
    assert.equal(next.player.captionSettings.peek().fontScale, 1.5);
    assert.equal(next.player.captionSettings.peek().color, '#ffff00');
    assert.equal(next.player.captionSettings.peek().backgroundOpacity, 0.5);
    assert.equal(next.player.captionSettings.peek().edge, 'outline');
  } finally { next.player.destroy(); }
});

test('missing preferred tracks use defaults without erasing the preference, including empty/partial lists', async () => {
  data.clear();
  const f = fixture();
  try {
    await f.open(audio, captions);
    f.player.setAudioTrack('original');
    await f.player.setCaptionTrack('turkish');
    await f.open([audio[0]], [captions[0]]);
    assert.equal(f.activeAudio.id, 'dub');
    assert.equal(f.player.captionTrack.peek().id, 'english');
    await f.open();
    assert.equal(f.player.audioTrack.peek(), null);
    assert.equal(f.player.captionTrack.peek(), null);
    await f.open(audio);
    assert.equal(f.activeAudio.id, 'original');
    assert.equal(f.player.captionTrack.peek(), null);
    await f.open([], captions);
    assert.equal(f.player.audioTrack.peek(), null);
    assert.equal(f.player.captionTrack.peek().id, 'turkish');
    await f.open(audio, captions);
    assert.equal(f.activeAudio.id, 'original');
    assert.equal(f.player.captionTrack.peek().id, 'turkish');
  } finally { f.player.destroy(); }
});

test('late track discovery restores preferences, and captions off stays off across content', async () => {
  data.clear();
  const f = fixture();
  try {
    await f.open(audio, captions);
    f.player.setAudioTrack('original');
    await f.player.setCaptionTrack('turkish');
    await f.open();
    await f.announce(audio, captions);
    assert.equal(f.activeAudio.id, 'original');
    assert.equal(f.player.captionTrack.peek().id, 'turkish');
    await f.player.setCaptionTrack(null);
    await f.open(audio, captions);
    assert.equal(f.player.captionTrack.peek(), null);
  } finally { f.player.destroy(); }
});

test('temporary defaults survive closing the player without replacing the saved preferences', async () => {
  data.clear();
  const first = fixture();
  try {
    await first.open(audio, captions);
    first.player.setAudioTrack('original');
    await first.player.setCaptionTrack('turkish');
    await first.open([audio[0], { id: 'unknown', lang: 'und', label: 'Audio 2' }], [{ ...captions[0], isDefault: false }]);
    assert.equal(first.activeAudio.id, 'dub');
    assert.equal(first.player.captionTrack.peek(), null);
  } finally { first.player.destroy(); }
  const next = fixture();
  try {
    await next.open(audio, captions);
    assert.equal(next.activeAudio.id, 'original');
    assert.equal(next.player.captionTrack.peek().id, 'turkish');
    await next.player.setCaptionTrack(null);
  } finally { next.player.destroy(); }
  const off = fixture();
  try {
    await off.open(audio, captions);
    assert.equal(off.player.captionTrack.peek(), null);
  } finally { off.player.destroy(); }
});
