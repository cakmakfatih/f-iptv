import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { captionText, hlsRenditions, trackLabel } from '../src/services/player-tracks.ts';

const tr = { original: 'Orijinal', audio: 'Ses', captions: 'Altyazı', languages: { tr: 'Türkçe', en: 'İngilizce', fr: 'Fransızca', pt: 'Portekizce', es: 'İspanyolca' } };
const en = { original: 'Original', audio: 'Audio', captions: 'Subtitles', languages: { tr: 'Turkish', en: 'English', fr: 'French', pt: 'Portuguese', es: 'Spanish' } };
const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Türkçe",LANGUAGE="tr",URI="tr.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Orijinal",URI="original.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="Turkish",LANGUAGE="tr",URI="captions/tr.m3u8?key=a,b"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English",LANGUAGE="en",URI="captions/en.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="other",NAME="Commentary",URI="commentary.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100000,AUDIO="a",SUBTITLES="s"\nvideo.m3u8\n';

test('native language codes use the selected UI language', () => {
  assert.equal(trackLabel({ lang: 'tr', label: 'tr' }, 'audio', tr, 0), 'Türkçe');
  assert.equal(trackLabel({ lang: 'tur', label: 'tur' }, 'audio', en, 0), 'Turkish');
  assert.equal(trackLabel({ lang: 'fr', label: 'French' }, 'captions', tr, 0), 'Fransızca');
});

test('original audio comes from the rendition name, never guessed from und', () => {
  const hint = { lang: '', label: 'Original Audio', url: 'https://cdn.test/original.m3u8' };
  assert.equal(trackLabel({ lang: 'und', label: 'und' }, 'audio', tr, 1, hint), 'Orijinal');
  assert.equal(trackLabel({ lang: 'und', label: 'und' }, 'audio', en, 1, hint), 'Original');
  assert.equal(trackLabel({ lang: 'und', label: 'und' }, 'audio', tr, 1), 'Ses 2');
  assert.equal(trackLabel({ lang: 'en', label: 'English commentary 5.1' }, 'audio', tr, 0), 'English commentary 5.1');
});

test('HLS renditions preserve quoted commas, selected groups and relative URLs', () => {
  const tracks = hlsRenditions(master, 'https://iptv.test/movie/master.m3u8');
  assert.equal(tracks.audio.length, 2);
  assert.equal(tracks.audio[1].label, 'Orijinal');
  assert.deepEqual(tracks.captions.map(t => [t.lang, t.url]), [['tr', 'https://iptv.test/movie/captions/tr.m3u8?key=a,b'], ['en', 'https://iptv.test/movie/captions/en.m3u8']]);
  assert.deepEqual(hlsRenditions('not HLS', 'https://iptv.test/a'), { audio: [], captions: [] });
  assert.equal(hlsRenditions(master.replace('captions/en.m3u8', 'javascript:bad()'), 'https://iptv.test/master').captions.length, 1);
});

async function fixture(run: (base: string, requests: string[]) => Promise<void>) {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url || '');
    const files: Record<string, string> = {
      '/tr.m3u8': '#EXTM3U\n#EXT-X-TARGETDURATION:100\n#EXTINF:100,\ntr.vtt\n#EXT-X-ENDLIST\n',
      '/tr.vtt': 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nMerhaba\n',
      '/en.vtt': 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello\n',
      '/parts.m3u8': '#EXTM3U\n#EXTINF:10,\none.vtt\n#EXTINF:10,\ntwo.vtt\n#EXT-X-ENDLIST\n',
      '/one.vtt': 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n00:00:01.000 --> 00:00:03.000\nFirst\n',
      '/two.vtt': 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:1800000\n\n00:00:01.000 --> 00:00:03.000 line:90%\nSecond\n',
      '/loop.m3u8': '#EXTM3U\nloop.m3u8\n#EXT-X-ENDLIST\n',
      '/html': '<html>not subtitles</html>',
    };
    if (req.url === '/slow') return;
    if (!files[req.url || '']) { res.writeHead(403); res.end('Forbidden'); return; }
    res.end(files[req.url || '']);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}

test('selected HLS subtitles resolve to VTT without fetching other languages', async () => {
  await fixture(async (base, requests) => {
    const text = await captionText(base + '/tr.m3u8', new AbortController().signal);
    assert.ok(text.startsWith('WEBVTT'));
    assert.ok(text.includes('Merhaba'));
    assert.deepEqual(requests, ['/tr.m3u8', '/tr.vtt']);
  });
});

test('segmented subtitles retain HLS timestamp offsets and cue settings', async () => {
  await fixture(async base => {
    const text = await captionText(base + '/parts.m3u8', new AbortController().signal);
    assert.ok(text.includes('00:00:01.000 --> 00:00:03.000'));
    assert.ok(text.includes('00:00:11.000 --> 00:00:13.000 line:90%'));
    assert.ok(text.includes('First') && text.includes('Second'));
  });
});

test('bad HTTP responses, non-VTT content and recursive playlists fail safely', async () => {
  await fixture(async base => {
    for (const path of ['/forbidden', '/html', '/loop.m3u8']) await assert.rejects(captionText(base + path, new AbortController().signal));
  });
});

test('unloading the source aborts outstanding subtitle requests', async () => {
  await fixture(async base => {
    const ctrl = new AbortController();
    const pending = captionText(base + '/slow', ctrl.signal);
    ctrl.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  });
});
