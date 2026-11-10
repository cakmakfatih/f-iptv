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

function fixture() {
  const video = Object.assign(new EventTarget(), {
    setAttribute() {}, removeAttribute() {}, load() {}, pause() {},
    paused: true, currentTime: 0, duration: 100, playbackRate: 1, volume: 1, muted: false,
    buffered: { length: 0 }, seekable: { length: 0 },
  });
  let callbacks;
  let activeAudio;
  const player = new RememberingPlayer({ video, pauseWhenHidden: false, gapJumping: false, engines: [() => ({
    name: 'fixture', async load(_video, source, _start, cb) {
      callbacks = cb;
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
    player, get activeAudio() { return activeAudio; },
    async open(audio = [], captions = []) {
      await player.cue({ url: 'https://media.test/movie', metadata: { audio, captions } });
      await settle();
    },
    async announce(audio, captions) { callbacks.audioTracks(audio); callbacks.captionTracks(captions); await settle(); },
  };
}

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
