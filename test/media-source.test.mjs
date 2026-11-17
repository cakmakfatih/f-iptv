import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/services/media.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { seriesPlaylist, vodSource } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const url = 'https://example.invalid/video';

test('only MKV episodes with a video codec skip probing and fallback', async () => {
  const episodes = [
    { id: 1, container_extension: 'mkv', info: { video: { codec_name: 'h264' } } },
    { id: 2, container_extension: 'mkv', info: {} },
    { id: 3, container_extension: 'mp4', info: { video: { codec_name: 'h264' } } },
  ];
  const list = seriesPlaylist('1', 'Series', { episodes: { 1: episodes } }, '');
  assert.equal(list[0].metadata.nativeContainer, 'mkv');
  assert.equal(list[1].metadata.nativeContainer, undefined);
  assert.equal(list[2].metadata.nativeContainer, undefined);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected fetch'); };
  try {
    const source = await vodSource(url, list[0]);
    assert.equal(source.type, 'progressive');
    assert.equal(source.metadata.tracksProbed, true);
    assert.equal(source.fallbacks, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('ambiguous sources still probe and retain the alternate format', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls.push(options.method);
    return new Response(null, { headers: { 'content-type': 'video/mp4' } });
  };
  try {
    const source = await vodSource(url, { metadata: { kind: 'series' } });
    assert.deepEqual(calls, ['HEAD']);
    assert.equal(source.type, 'progressive');
    assert.deepEqual(source.fallbacks, [{ url, type: 'hls' }]);
    assert.equal(source.metadata.tracksProbed, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('HLS sources still probe the manifest and retain the alternate format', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls.push(options.method || 'GET');
    return options.method === 'HEAD'
      ? new Response(null, { headers: { 'content-type': 'application/vnd.apple.mpegurl' } })
      : new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en"');
  };
  try {
    const source = await vodSource(url, {});
    assert.deepEqual(calls, ['HEAD', 'GET']);
    assert.equal(source.type, 'hls');
    assert.deepEqual(source.fallbacks, [{ url, type: 'progressive' }]);
    assert.equal(source.metadata.hlsTracks.audio[0].lang, 'en');
    assert.equal(source.metadata.tracksProbed, true);
  } finally { globalThis.fetch = originalFetch; }
});
