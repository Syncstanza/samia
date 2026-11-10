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
      const r = simulate(data, { errorRate, rakahs: 8, seed, start: [2, 142] });
      assert.equal(r.wrongVerse, 0, `wrong ayah at error ${errorRate}, seed ${seed}`);
      assert.ok(r.correct >= 90, `only ${r.correct}% correct at error ${errorRate}, seed ${seed}`);
    }
  }
});

test('simulated cold start in short-ayah surahs stays mostly right', () => {
  for (const start of [[36, 1], [55, 1], [78, 1], [87, 1]]) {
    const r = simulate(data, { errorRate: 0.2, rakahs: 4, seed: 1, start, cold: true });
    assert.ok(r.wrongVerse <= 5, `${start.join(':')}: ${r.wrongVerse}% wrong`);
  }
});

test('live mode (sliding 4 s window): never a wrong ayah in juz 2', () => {
  for (const seed of [1, 2, 3]) {
    const r = simulate(data, { errorRate: 0.2, rakahs: 8, seed, start: [2, 142], window: 4 });
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

import { Salah } from '../src/engine/salah.js';

test('salah: "الله أكبر" inside an ayah (9:72, 29:45, 40:10) never shows ruku\'', () => {
  for (const [s, a] of [[9, 72], [29, 45], [40, 10]]) {
    for (const seed of [1, 2, 3]) {
      const tr = new Tracker(ix);
      const salah = new Salah();
      tr.setStart(s, a - 2);
      // Recite from two ayat before to two after, as one continuous stream.
      const from = ix.ayahStart[ix.indexOf(s, a - 2)], to = ix.ayahStart[ix.indexOf(s, a + 2) + 1];
      const text = ix.letters.slice(from, to);
      let state = seed;
      const rand = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
      const window = [];
      for (let p = 0; p < text.length; p += 12) {
        let chunk = '';
        for (const ch of text.slice(p, p + 12)) chunk += rand() < 0.1 ? 'ب' : ch;
        window.push(chunk); if (window.length > 4) window.shift();
        const res = tr.observe(window.join(''), 1 / window.length);
        if (res.clearAudio) window.length = 0;
        const v = salah.step(res, 0.6);
        assert.notEqual(v.position, 'RUKU', `${s}:${a} seed ${seed}`);
      }
    }
  }
});

test('salah: full rak\'ah sequence from calls', () => {
  const salah = new Salah();
  const say = (call) => salah.step({ call, speech: true, heard: '' }, 0.6);
  const quiet = (n) => { let v; for (let i = 0; i < n; i++) v = salah.step({ speech: false }, 0.6); return v; };
  const recite = (n) => { let v; for (let i = 0; i < n; i++) v = salah.step({ progressed: true, speech: true, heard: 'x' }, 0.6); return v; };
  recite(6);
  say('takbir'); assert.equal(quiet(3).position, 'RUKU');
  say('tasmi'); assert.equal(quiet(2).position, 'QAWMAH');
  say('takbir'); assert.equal(quiet(2).position, 'SUJOOD_1');
  say('takbir'); assert.equal(quiet(2).position, 'JALSAH');
  say('takbir'); assert.equal(quiet(2).position, 'SUJOOD_2');
  say('takbir'); const rising = quiet(2);
  assert.equal(rising.position, 'RISING'); assert.match(rising.note, /2nd/);
  assert.equal(recite(3).rakah, 2);
  say('takbir'); quiet(3); say('tasmi'); say('takbir'); quiet(2); say('takbir'); quiet(2); say('takbir'); quiet(2);
  say('takbir'); assert.equal(quiet(2).position, 'TASHAHHUD');
  say('salam'); assert.equal(quiet(1).position, 'SALAM');
  say('takbir'); assert.equal(quiet(1).position, 'QIYAM');
  assert.equal(salah.view().rakah, 1);
});

test('salah: a standing takbir followed by more recitation is not ruku\'', () => {
  const salah = new Salah();
  for (let i = 0; i < 6; i++) salah.step({ progressed: true, speech: true, heard: 'x' }, 0.6);
  salah.step({ call: 'takbir', speech: true, heard: '' }, 0.6);
  for (let i = 0; i < 6; i++) assert.equal(salah.step({ progressed: i > 1, speech: true, heard: 'ولذكراللهاكبر' }, 0.6).position, 'QIYAM');
});

test('simulated taraweeh: prayer positions follow, no false ruku\'', () => {
  for (const start of [[2, 142], [29, 40], [40, 6]]) {
    const r = simulate(data, { errorRate: 0.15, rakahs: 8, seed: 1, start, window: 4 });
    assert.equal(r.falseRuku, 0, `${start.join(':')}`);
    assert.ok(r.positionCorrect >= 90, `${start.join(':')}: ${r.positionCorrect}%`);
  }
});

test('salah: the real ruku\' takbir right after 29:45 (which contains "الله أكبر") is caught', () => {
  const tr = new Tracker(ix);
  const salah = new Salah();
  tr.setStart(29, 44);
  const from = ix.ayahStart[ix.indexOf(29, 44)], to = ix.ayahStart[ix.indexOf(29, 45) + 1];
  const text = ix.letters.slice(from, to);
  let v;
  for (let p = 0; p < text.length; p += 12) v = salah.step(tr.push(text.slice(p, p + 12)), 0.6);
  v = salah.step(tr.push('الله اكبر'), 0.6);
  for (let k = 0; k < 3; k++) v = salah.step(tr.push(''), 0.6);
  assert.equal(v.position, 'RUKU');
});
