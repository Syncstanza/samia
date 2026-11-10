import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRequest, startServer } from '../src/server.js';

test('server: serves app folders, refuses everything else', () => {
  assert.ok(resolveRequest('/'));
  assert.ok(resolveRequest('/src/renderer/app.js'));
  assert.ok(resolveRequest('/vendor/ort/ort.wasm.min.mjs'));
  assert.equal(resolveRequest('/package.json'), null);
  assert.equal(resolveRequest('/src/../package.json'), null);
  assert.equal(resolveRequest('/data/..%2F..%2Fpackage.json'), null);
  assert.equal(resolveRequest('/src\\renderer\\app.js'), null);
  assert.equal(resolveRequest('/.git/config'), null);
});

test('server: every file the display loads comes back 200 with isolation headers', async () => {
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/src/renderer/app.js', '/src/renderer/styles.css', '/src/engine/worker.js',
      '/data/quran/quran.json', '/docs/logo.png', '/vendor/fonts/amiri-quran.css',
      '/vendor/ort/ort.wasm.min.mjs', '/vendor/ort/ort-wasm-simd-threaded.wasm']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('cross-origin-embedder-policy'), 'require-corp', path);
      await res.arrayBuffer();
    }
    assert.equal((await fetch(base + '/package.json')).status, 404);
  } finally {
    server.close();
  }
});
