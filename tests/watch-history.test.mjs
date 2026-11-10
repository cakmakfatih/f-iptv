import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)),
} });
globalThis.window = new EventTarget();
const bundle = await build({ stdin: { contents: "export {history} from './src/services/history'; export {api} from './src/services/api';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const { history, api } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
api.serverUrl = 'https://history.test'; api.username = 'test'; api.password = 'test';
const episode = (id, currentTime, duration = 1000) => ({
  contentId: history.makeContentId('series', 'show', id), streamType: 'series', seriesId: 'show', episodeId: id,
  title: 'Series', subtitle: 'Episode ' + id, seriesName: 'Series', seasonNum: 1, episodeNum: Number(id),
  streamUrl: api.getEpisodeStreamUrl(id, 'mp4'), currentTime, duration,
});

test('finishing an episode and leaving its successor immediately preserves the series resume entry', () => {
  for (const seconds of [0, 1, 2]) {
    storage.clear();
    history.saveProgress(episode('1', 900));
    history.saveProgress(episode('1', 970));
    history.saveProgress(episode('2', seconds, 0));
    const list = history.getSeriesContinueList();
    assert.equal(list.length, 1, 'the series must stay in continue watching at ' + seconds + ' seconds');
    assert.equal(list[0].episodeId, '2');
    assert.equal(list[0].currentTime, seconds);
    assert.ok(list[0].duration > 0);
    if (seconds === 0) assert.equal(list[0].progressPercent, 0);
  }
});

test('a new episode bookmark is updated by real playback duration and position', () => {
  storage.clear();
  history.saveProgress(episode('2', 0, 0));
  history.saveProgress(episode('2', 7, 1800));
  assert.equal(history.getSeriesContinueList()[0].currentTime, 7);
  assert.equal(history.getSeriesContinueList()[0].duration, 1800);
  assert.equal(history.getProgress(episode('2', 0).contentId).episodeId, '2');
});

test('movies still require actual viewing before being added to continue watching', () => {
  storage.clear();
  const movie = { contentId: 'vod_1', streamType: 'vod', title: 'Movie', subtitle: '', streamUrl: api.serverUrl + '/movie/test/test/1.mp4', currentTime: 1, duration: 1000 };
  history.saveProgress(movie);
  assert.equal(history.getVodContinueList().length, 0);
  history.saveProgress({ ...movie, currentTime: 10 });
  assert.equal(history.getVodContinueList().length, 1);
});
