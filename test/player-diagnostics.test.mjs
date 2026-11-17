import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const script = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/services/player-diagnostics.ts', import.meta.url))],
  bundle: true, format: 'iife', globalName: 'Diagnostics', target: 'chrome67', write: false,
}).outputFiles[0].text;

function fixture(search = '?playerDebug=1') {
  const requests = [], events = new Map(), timers = new Map();
  const video = {
    readyState: 0, networkState: 2, currentTime: 0, paused: true, videoWidth: 0, videoHeight: 0, error: null,
    canPlayType: () => '', play: () => Promise.resolve(),
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name) => events.delete(name),
  };
  const player = {
    video, engineName: { peek: () => 'native' }, getState: () => 3,
    source: { peek: () => ({ type: 'progressive', url: 'https://media.example/private.mkv?token=private-token' }) },
    on: () => () => {},
  };
  const context = {
    URLSearchParams, window: { location: { search }, addEventListener: () => {}, removeEventListener: () => {} },
    fetch: (url, options) => { requests.push({ url, options }); return Promise.resolve({ ok: true }); },
    setTimeout: (fn, delay) => { timers.set(delay, fn); return delay; }, clearTimeout: (id) => timers.delete(id),
    MediaSource: { isTypeSupported: () => false },
  };
  const api = runInNewContext(script + '; Diagnostics;', context);
  return { player, video, requests, events, timers, install: () => api.installPlayerDiagnostics(player) };
}

test('playback diagnostics stay inactive without explicit opt-in', () => {
  const f = fixture('');
  const original = f.video.play;
  f.install()();
  assert.equal(f.requests.length, 0);
  assert.equal(f.events.size, 0);
  assert.equal(f.video.play, original);
});

test('playback diagnostics report media failures without source URLs or tokens', async () => {
  const f = fixture();
  f.video.play = () => Promise.reject(Object.assign(new Error('https://media.example/?token=private-token'), { name: 'NotSupportedError' }));
  const original = f.video.play;
  const cleanup = f.install();
  assert.ok(f.requests.length > 0);
  await assert.rejects(f.video.play());
  await Promise.resolve();
  assert.ok(f.requests.some(r => r.url.includes('NotSupportedError')));
  const reports = JSON.stringify(f.requests);
  assert.ok(!reports.includes('media.example'));
  assert.ok(!reports.includes('private-token'));
  cleanup();
  assert.equal(f.events.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.video.play, original);
});

test('playback diagnostics bound request volume', () => {
  const f = fixture();
  const cleanup = f.install();
  assert.ok(f.events.has('waiting'));
  for (let i = 0; i < 100; i++) f.events.get('waiting')();
  assert.ok(f.requests.length <= 40);
  cleanup();
});
