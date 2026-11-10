import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
  stdin: { contents: "export { playerEngine } from './src/services/player-engine'; export { setLang } from './src/i18n'; export { vodSource } from './src/services/media';", resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { playerEngine, setLang, vodSource } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function video() {
  const element = new EventTarget();
  return Object.assign(element, {
    src: '', videoHeight: 0, duration: 100,
    audioTracks: [{ id: 'tr', language: 'tr', label: '', enabled: true }, { id: 'other', language: 'und', label: '', enabled: false }],
    textTracks: [],
    canPlayType: () => 'probably',
    load() { element.dispatchEvent(new Event('loadedmetadata')); },
    removeAttribute() {},
  });
}

test('native TV tracks are localized, selectable and resolve fresh subtitle URLs on demand', async () => {
  const oldFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(url);
    if (url === 'https://iptv.test/movie.mp4') return new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="tr",NAME="Turkish",URI="https://iptv.test/fresh/tr.m3u8"\n');
    if (url === 'https://iptv.test/fresh/tr.m3u8') return new Response('#EXTM3U\n#EXTINF:100,\nhttps://iptv.test/fresh/tr.vtt\n#EXT-X-ENDLIST\n');
    if (url === 'https://iptv.test/fresh/tr.vtt') return new Response('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nMerhaba\n');
    throw new Error('Unexpected subtitle request: ' + url);
  };
  try {
    for (const lang of ['tr', 'en']) {
      setLang(lang);
      const v = video();
      const source = { url: 'https://iptv.test/movie.mp4', type: 'hls', metadata: { hlsTracks: {
        audio: [{ lang: 'tr', label: 'Türkçe' }, { lang: '', label: 'Orijinal' }],
        captions: [{ lang: 'tr', label: 'Turkish', url: 'https://iptv.test/expired/tr.m3u8' }],
      } } };
      const engine = playerEngine(source, v);
      let audio = [], captions = [];
      const noop = () => {};
      await engine.load(v, source, undefined, {
        qualities: noop, quality: noop, audioTracks: tracks => { audio = tracks; }, audioTrack: noop,
        captionTracks: tracks => { captions = tracks; }, error: noop, liveEnded: noop, emsg: noop,
      });
      assert.deepEqual(audio.map(t => t.label), lang === 'tr' ? ['Türkçe', 'Orijinal'] : ['Turkish', 'Original']);
      assert.equal(captions[0].label, lang === 'tr' ? 'Türkçe' : 'Turkish');
      engine.setAudioTrack('other');
      assert.equal(v.audioTracks[1].enabled, true);
      assert.equal(v.audioTracks[0].enabled, false);
      const before = requests.length;
      assert.match(await engine.loadCaptionTrack(captions[0].id), /Merhaba/);
      assert.equal(requests.length - before, 3);
      await engine.loadCaptionTrack(captions[0].id);
      assert.equal(requests.length - before, 3, 'reselecting cached captions does not redownload');
      engine.destroy();
    }
    assert.ok(!requests.some(url => url.includes('expired')));
    assert.equal(playerEngine({ url: 'https://iptv.test/video.mpd', type: 'dash' }, video()), null);
  } finally { globalThis.fetch = oldFetch; }
});

test('VOD probing reads full HLS renditions behind MP4 URLs without consuming video bodies', async () => {
  const oldFetch = globalThis.fetch;
  const requests = [];
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Turkish",LANGUAGE="tr",URI="tr.m3u8"\n';
  globalThis.fetch = async (_url, init) => {
    requests.push(init.headers);
    return new Response(master, { status: init.headers ? 206 : 200, headers: { 'Content-Type': 'audio/x-mpegurl' } });
  };
  try {
    const source = await vodSource('https://iptv.test/movie.mp4', { metadata: { kind: 'vod' } });
    assert.equal(source.type, 'hls');
    assert.equal(source.metadata.kind, 'vod');
    assert.equal(source.metadata.hlsTracks.captions[0].url, 'https://iptv.test/tr.m3u8');
    assert.equal(requests.length, 2);
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'video/mp4' } });
    assert.equal((await vodSource('https://iptv.test/file.mp4', {})).type, 'progressive');
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = oldFetch; }
});
