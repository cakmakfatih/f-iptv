import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/components/route-history.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { subscribeRouteHistory } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function setup() {
  const target = new EventTarget();
  const entry = {};
  const listeners = new Set();
  const router = { current: entry, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  const navigate = current => { router.current = current; for (const fn of listeners) fn(); };
  const update = () => target.dispatchEvent(new Event('app:history-updated'));
  return { target, entry, router, listeners, navigate, update };
}

test('visible updates dispatch immediately; hidden updates coalesce until route return', () => {
  const s = setup();
  let calls = 0;
  const off = subscribeRouteHistory(s.target, s.router, s.entry, () => calls++);
  s.update();
  assert.equal(calls, 1);
  s.navigate({});
  s.update(); s.update(); s.update();
  assert.equal(calls, 1);
  s.navigate(s.entry);
  assert.equal(calls, 2);
  s.navigate({}); s.navigate(s.entry);
  assert.equal(calls, 2);
  s.update();
  assert.equal(calls, 3);
  off();
});

test('flush uses the latest callback and cleanup removes both subscriptions', () => {
  const s = setup();
  const calls = [];
  let callback = () => calls.push('old');
  const off = subscribeRouteHistory(s.target, s.router, s.entry, () => callback());
  s.navigate({}); s.update();
  callback = () => calls.push('new');
  s.navigate(s.entry);
  assert.deepEqual(calls, ['new']);
  s.navigate({}); s.update();
  off();
  assert.equal(s.listeners.size, 0);
  s.navigate(s.entry); s.update();
  assert.deepEqual(calls, ['new']);
});
