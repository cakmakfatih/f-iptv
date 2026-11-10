import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/services/api.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { api } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('movie and series catalogs rank by descending rating across categories, cache and refresh', async () => {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const rows = [
    { id: 'unrated', rating: '' },
    { id: 'lower', rating: '6.2' },
    { id: 'tied-first', rating: '8.9' },
    { id: 'tied-second', rating: '89' },
    { id: 'highest', rating_5based: '5', rating: '1' },
    { id: 'invalid', rating: 'NaN' },
    { id: 'fallback', rating_5based: '0', rating: '9.5' },
    { id: 'infinite', rating: 'Infinity' },
  ];
  const categories = [{ category_id: '2', category_name: 'Drama' }, { category_id: '1', category_name: 'Comedy' }];
  const expected = ['highest', 'fallback', 'tied-first', 'tied-second', 'lower', 'unrated', 'invalid', 'infinite'];
  let requests = 0;
  globalThis.fetch = async url => {
    requests++;
    const action = new URL(url).searchParams.get('action');
    return new Response(JSON.stringify(action.endsWith('categories') ? categories : rows.map(row => ({ ...row, stream_id: row.id, series_id: row.id, category_id: '2' }))));
  };
  api.serverUrl = 'https://catalog.test';
  api.username = 'test';
  api.password = 'test';
  try {
    for (const get of [id => api.getVodStreams(id), id => api.getSeriesList(id)]) {
      for (const category of [undefined, '2']) {
        const result = await get(category);
        assert.deepEqual(result.map(row => row.id), expected);
        assert.equal(result.find(row => row.id === 'highest').category_id, '2');
        const before = requests;
        assert.deepEqual((await get(category)).map(row => row.id), expected);
        assert.equal(requests, before, 'cached catalogs keep the sorted order');
      }
    }
    assert.deepEqual(await api.getVodCategories(), categories);
    assert.deepEqual(await api.getSeriesCategories(), categories);
    rows[1].rating = '9.8';
    await api.refreshContent();
    for (const result of [await api.getVodStreams(), await api.getSeriesList('2')]) {
      assert.deepEqual(result.slice(0, 3).map(row => row.id), ['highest', 'lower', 'fallback']);
    }
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.window = oldWindow;
  }
});
