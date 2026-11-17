import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/services/api.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'catalog-storage-fixture',
    setup(b) {
      b.onResolve({ filter: /^\.\/catalog-cache$/ }, () => ({ path: 'catalog-cache', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export async function readCatalogList(key) { return globalThis.testCatalogStorage.get(JSON.stringify(key)); }
        export async function writeCatalogList(key, value) { globalThis.testCatalogStorage.set(JSON.stringify(key), value); }
        export async function removeCatalogLists() {}
      ` }));
    },
  }],
});
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64');
const profiles = ['alice', 'bob'].map(username => ({ id: username, username, name: username, serverUrl: 'https://catalog.test', password: 'fixture' }));

test('catalogs open from the saved account snapshot after reload and keep it on a refresh failure', async () => {
  globalThis.testCatalogStorage = new Map();
  globalThis.window = new EventTarget();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => key === 'profiles_key' ? JSON.stringify(profiles) : null,
  } });
  const originalFetch = globalThis.fetch;
  const requests = [];
  const film = { stream_id: 7, name: 'Film', rating: '8', container_extension: 'mp4' };
  try {
    globalThis.fetch = async url => {
      requests.push(url);
      return Response.json([film]);
    };
    const first = (await import(moduleUrl + '#first')).api;
    assert.equal(first.selectProfile('alice'), true);
    assert.equal((await first.getVodStreams())[0].name, 'Film');
    assert.equal(requests.length, 1);
    const second = (await import(moduleUrl + '#reload')).api;
    assert.equal(second.selectProfile('alice'), true);
    globalThis.fetch = async url => { requests.push(url); return new Response(null, { status: 503 }); };
    assert.equal((await second.getVodStreams())[0]?.name, 'Film');
    assert.equal(requests.length, 1, 'startup should not wait for or initiate a request for a recently cached catalog');
    await second.refreshContent();
    assert.equal(requests.length, 2);
    assert.equal((await second.getVodStreams())[0]?.name, 'Film', 'a failed refresh should preserve cached data');
    assert.equal(second.selectProfile('bob'), true);
    assert.deepEqual(await second.getVodStreams(), []);
    assert.equal(requests.length, 3, 'another account must fetch its own catalog');
    assert.equal(second.selectProfile('alice'), true);
    assert.equal((await second.getVodStreams())[0]?.name, 'Film');
    let playbackStarted = false;
    second.isBusy = () => playbackStarted;
    globalThis.fetch = async () => {
      playbackStarted = true;
      return Response.json([{ ...film, name: 'Updated film' }]);
    };
    await second.refreshContent();
    assert.equal((await second.getVodStreams())[0]?.name, 'Film', 'playback defers processing a response already in flight');
    playbackStarted = false;
    globalThis.fetch = async () => Response.json([]);
    await second.refreshContent();
    assert.deepEqual(await second.getVodStreams(), [], 'a valid empty result must replace the previous list');
  } finally { globalThis.fetch = originalFetch; }
});
