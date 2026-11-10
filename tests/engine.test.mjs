import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize } from '../src/engine/normalize.js';
import { buildIndex } from '../src/engine/quran-index.js';
import { Tracker } from '../src/engine/tracker.js';
import { simulate } from '../tools/simulate.mjs';

const data = JSON.parse(readFileSync(new URL('../data/quran/quran.json', import.meta.url), 'utf8'));
const ix = buildIndex(data);

test('data: 6236 ayat, 114 surahs, 30 juz', () => {
  assert.equal(data.ayat.length, 6236);
  assert.equal(data.surahs.length, 114);
  assert.equal(data.juz.length, 30);
  assert.deepEqual(data.juz[1].start, [2, 142]);
});

test('normalize: Uthmani and standard spelling meet', () => {
  assert.equal(normalize('ٱلرَّحْمَٰنِ'), normalize('الرحمن'));
  assert.equal(normalize('إِيَّاكَ نَعْبُدُ'), normalize('اياك نعبد'));
  assert.equal(normalize('ٱلصِّرَٰطَ'), 'الصرط');
});

test('index: bismillah is kept out of ayah 1 of later surahs', () => {
  const i = ix.indexOf(2, 1);
  assert.equal(ix.letters.slice(ix.ayahStart[i], ix.ayahStart[i + 1]), 'الم');
  const j = ix.indexOf(95, 1); // Tanzil spells this bismillah with an extra shadda
  assert.ok(ix.letters.slice(ix.ayahStart[j], ix.ayahStart[j + 1]).startsWith('والتين'));
});

test('tracker: clean recitation of Ayat al-Kursi is found from cold', () => {
  const tr = new Tracker(ix);
  const i = ix.indexOf(2, 255);
  const text = ix.letters.slice(ix.ayahStart[i], ix.ayahStart[i + 1]);
  let res;
  for (let p = 0; p < text.length; p += 12) res = tr.push(text.slice(p, p + 12));
  assert.equal(res.ayah.surah, 2);
  assert.equal(res.ayah.ayah, 255);
});

test('tracker: manual next/prev', () => {
  const tr = new Tracker(ix);
  tr.jumpTo(ix.indexOf(18, 10));
  assert.equal(tr.next().ayah.ayah, 11);
  assert.equal(tr.prev().ayah.ayah, 10);
});

test('simulated taraweeh (juz 2, 15% and 25% letter errors): never a wrong ayah', () => {
  for (const errorRate of [0.15, 0.25]) {
    for (const seed of [1, 2, 3]) {
      const r = simulate(data, { errorRate, sets: 8, seed, start: [2, 142] });
      assert.equal(r.wrongVerse, 0, `wrong ayah at error ${errorRate}, seed ${seed}`);
      assert.ok(r.correct >= 90, `only ${r.correct}% correct at error ${errorRate}, seed ${seed}`);
    }
  }
});

test('simulated cold start in short-ayah surahs stays mostly right', () => {
  for (const start of [[36, 1], [55, 1], [78, 1], [87, 1]]) {
    const r = simulate(data, { errorRate: 0.2, sets: 4, seed: 1, start, cold: true });
    assert.ok(r.wrongVerse <= 5, `${start.join(':')}: ${r.wrongVerse}% wrong`);
  }
});

test('live mode (sliding 4 s window): never a wrong ayah in juz 2', () => {
  for (const seed of [1, 2, 3]) {
    const r = simulate(data, { errorRate: 0.2, sets: 8, seed, start: [2, 142], window: 4 });
    assert.equal(r.wrongVerse, 0, `seed ${seed}`);
    assert.ok(r.correct >= 90, `seed ${seed}: ${r.correct}%`);
  }
});

test('tracker: reports how far into the ayah the recitation is', () => {
  const tr = new Tracker(ix);
  tr.setStart(2, 255);
  const i = ix.indexOf(2, 255);
  const text = ix.letters.slice(ix.ayahStart[i], ix.ayahStart[i + 1]);
  let res, last = -1, grew = 0;
  for (let p = 0; p < text.length; p += 12) {
    res = tr.push(text.slice(p, p + 12));
    if (res.ayah && res.ayah.index === i) { if (res.letter > last) grew++; last = res.letter; }
  }
  assert.ok(grew > 10, `progress moved ${grew} times`);
  assert.ok(last >= text.length - 2, `ended at ${last} of ${text.length}`);
});


test('live mode with stray room-noise letters: never a wrong ayah in juz 2', () => {
  for (const seed of [1, 2]) {
    const r = simulate(data, { errorRate: 0.15, sets: 6, seed, start: [2, 142], window: 4, roomNoise: 0.35 });
    assert.ok(r.wrongVerse <= 0.5, `seed ${seed}: ${r.wrongVerse}% wrong`);
  }
});
