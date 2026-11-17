import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(entry, userAgent) {
  const bundle = await build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false,
    define: { navigator: JSON.stringify({ userAgent }) },
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}

const { isLegacyTvUserAgent } = await load('src/services/device.ts', '');

test('detects old Chrome and Chromium but leaves modern and unknown engines alone', () => {
  for (const ua of [
    'Mozilla/5.0 (SMART-TV; Linux; Vestel) AppleWebKit/537.36 Chrome/67.0.3396.87 Safari/537.36',
    'Mozilla/5.0 Chromium/70.0.3538.0 Safari/537.36',
  ]) assert.equal(isLegacyTvUserAgent(ua), true, ua);
  for (const ua of [
    'Mozilla/5.0 Chrome/71.0.3578.80 Safari/537.36',
    'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 Firefox/67.0', '', 'Chrome/0.0', 'Chrome/unknown',
  ]) assert.equal(isLegacyTvUserAgent(ua), false, ua);
});

test('legacy grid reduces overscan without changing geometry or modern defaults', async () => {
  const legacy = await load('src/components/grid.ts', 'Chrome/67.0.3396.87');
  const modern = await load('src/components/grid.ts', 'Chrome/120.0.0.0');
  const unknown = await load('src/components/grid.ts', 'Unknown');
  assert.equal(legacy.GRID.overscan, 1);
  assert.equal(modern.GRID.overscan, undefined);
  assert.deepEqual(unknown.GRID, modern.GRID);
  const { overscan, ...geometry } = legacy.GRID;
  assert.deepEqual(geometry, modern.GRID);
  assert.deepEqual(legacy.GRID_CLASS, modern.GRID_CLASS);
});
