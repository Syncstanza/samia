import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewer, isTestBuild, cleanAnnouncements, pickAsset, RELEASE_URL } from '../src/renderer/news-core.js';
import { WHATS_NEW } from '../src/renderer/whatsnew.js';
import { readFileSync } from 'node:fs';

test('versions: newer, older, same, test builds', () => {
  assert.equal(isNewer('1.1.0', '1.0.0'), true);
  assert.equal(isNewer('v1.0.10', '1.0.9'), true);
  assert.equal(isNewer('2.0.0', '1.9.9'), true);
  assert.equal(isNewer('1.0.0', '1.1.0'), false);
  assert.equal(isNewer('1.1.0', '1.1.0'), false);
  assert.equal(isNewer('1.2.0', '0.1.19-dev'), false); // test builds never update
  assert.equal(isTestBuild('0.1.19-dev'), true);
  assert.equal(isTestBuild('0.1.2-taraweeh'), true);
  assert.equal(isTestBuild('1.1.0'), false);
});

test('announcements: cleaned, newest first, expired and broken ones dropped', () => {
  const now = Date.parse('2026-11-12');
  const list = cleanAnnouncements({ items: [
    { id: 1, title: 'Old', text: 'first' },
    { id: 3, title: 'New', text: 'third', date: '2026-11-12T10:00' },
    { id: 2, text: 'expired', until: '2026-11-01' },
    { id: 'x', text: 'bad id' },
    { id: 4, text: '   ' },
    null,
  ] }, now);
  assert.deepEqual(list.map((a) => a.id), [3, 1]);
  assert.equal(list[0].date, '2026-11-12');
  assert.deepEqual(cleanAnnouncements(null), []);
  assert.deepEqual(cleanAnnouncements({ items: 'nope' }), []);
});

test('the repo announcements file is valid', () => {
  const list = cleanAnnouncements(JSON.parse(readFileSync(new URL('../announcements.json', import.meta.url))));
  assert.ok(Array.isArray(list));
});

test('update downloads: the right file for each kind of copy, with its checksum', () => {
  const base = 'https://github.com/Syncstanza/samia/releases/download/v1.1.0/';
  const assets = ['Samia-Setup-1.1.0.exe', 'Samia-1.1.0.exe', 'Samia-1.1.0.AppImage', 'Samia-1.1.0.exe.sha256', 'Samia-Setup-1.1.0.exe.sha256', 'Samia-1.1.0.AppImage.sha256']
    .map((name) => ({ name, url: base + name }));
  assert.equal(pickAsset('portable', assets).bin.name, 'Samia-1.1.0.exe');
  assert.equal(pickAsset('portable', assets).sum.name, 'Samia-1.1.0.exe.sha256');
  assert.equal(pickAsset('installer', assets).bin.name, 'Samia-Setup-1.1.0.exe');
  assert.equal(pickAsset('appimage', assets).bin.name, 'Samia-1.1.0.AppImage');
  assert.equal(pickAsset('appimage', assets.filter((a) => !a.name.endsWith('.sha256'))).sum, null);
  assert.equal(pickAsset('other', assets), null);
  assert.ok(RELEASE_URL.test(base + 'Samia-1.1.0.exe'));
  assert.ok(!RELEASE_URL.test('https://example.com/Syncstanza/samia/releases/x'));
});

test("what's new: newest first, ids go up, the newest matches package.json", () => {
  const ids = WHATS_NEW.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  assert.equal(new Set(ids).size, ids.length);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(WHATS_NEW[0].version, pkg.version, "add a What's new entry for this version (src/renderer/whatsnew.js)");
});
