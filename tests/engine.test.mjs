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

test('a turn never leaves its passage', () => {
  const tr = new Tracker(ix);
  const from = ix.indexOf(78, 1), to = ix.indexOf(78, 5);
  tr.setStart(78, 1);
  tr.setBounds(from, to);
  // The reciter goes on into a different surah: the screen must stay in 78:1-5.
  for (const t of ['عم يتساءلون عن النبا العظيم', 'قل هو الله احد الله الصمد', 'لم يلد ولم يولد ولم يكن له كفوا احد', 'قل اعوذ برب الفلق من شر ما خلق']) {
    const r = tr.push(t);
    if (r.ayah) assert.ok(r.ayah.index >= from && r.ayah.index <= to, `left the passage: ${r.ayah.surah}:${r.ayah.ayah}`);
  }
});

test('a repeated word: the first one is not skipped when the model runs ahead', () => {
  // Real case (al-Fatiha 1:7): the reciter has said "...أنعمت عليهم" but the speech
  // model, knowing the ayah, already writes "...عليهم ولا الضالين".
  const tr = new Tracker(ix);
  const i = ix.indexOf(1, 7);
  tr.jumpTo(i);
  tr.push('صراط الذين أنعمت عليهم');
  const firstEnd = tr.pos;
  const r = tr.observe('صرط الذين انعمت عليهم ولا الضالين', 0.3);
  assert.ok(tr.pos - firstEnd < 6, `jumped ${tr.pos - firstEnd} letters past the first عليهم`);
  assert.equal(r.ayah.index, i);
});

test('tracker: a short surah (al-Kawthar) is found from cold during its first ayah, not its last', () => {
  const tr = new Tracker(ix);
  const first = ix.letters.slice(ix.ayahStart[ix.indexOf(108, 1)], ix.ayahStart[ix.indexOf(108, 2)]);
  let res;
  for (let p = 0; p < first.length + 4; p += 4) res = tr.push(first.slice(p, p + 4));
  assert.equal(res.ayah.surah, 108);
  assert.ok(res.ayah.ayah <= 2);
});

test('tracker: moving from one surah to a short different one (al-Mulk, then al-Asr) is found quickly', () => {
  const tr = new Tracker(ix);
  const text = (s, n) => { let t = ''; for (let i = ix.indexOf(s, 1), k = 0; k < n; k++, i++) t += ix.letters.slice(ix.ayahStart[i], ix.ayahStart[i + 1]); return t; };
  const mulk = text(67, 5);
  for (let p = 0; p < mulk.length; p += 8) tr.push(mulk.slice(p, p + 8));
  assert.equal(tr.shown >= 0 && tr.ix.ref(tr.shown).surah, 67);
  const asr = text(103, 3);
  let at = -1;
  for (let p = 0; p < asr.length; p += 8) {
    const r = tr.push(asr.slice(p, p + 8));
    if (at < 0 && r.ayah && r.ayah.surah === 103) at = p + 8;
  }
  assert.ok(at > 0 && at <= asr.length, `found at ${at} of ${asr.length}`);
});

test('tracker: Bismillah before a surah does not send it to al-Fatiha (or al-Naml) - al-Kawthar is found in its first ayah', () => {
  const text = (s, n) => { let t = ''; for (let i = ix.indexOf(s, 1), k = 0; k < n; k++, i++) t += ix.letters.slice(ix.ayahStart[i], ix.ayahStart[i + 1]); return t; };
  const tr = new Tracker(ix);
  const s = 'بسماللهالرحمنالرحيم' + text(108, 3);
  const seen = [];
  for (let p = 0; p < s.length; p += 8) { const r = tr.push(s.slice(p, p + 8)); if (r.ayah) seen.push(`${r.ayah.surah}:${r.ayah.ayah}`); }
  assert.ok(seen.length > 0 && seen.every((a) => a.startsWith('108:')), `shown: ${seen}`);
});

test('tracker: al-Mulk, then Bismillah and al-Kawthar: found within the second ayah', () => {
  const text = (s, n) => { let t = ''; for (let i = ix.indexOf(s, 1), k = 0; k < n; k++, i++) t += ix.letters.slice(ix.ayahStart[i], ix.ayahStart[i + 1]); return t; };
  const tr = new Tracker(ix);
  const mulk = text(67, 5);
  for (let p = 0; p < mulk.length; p += 8) tr.push(mulk.slice(p, p + 8));
  const to = 'بسماللهالرحمنالرحيم' + text(108, 3);
  let at = -1;
  for (let p = 0; p < to.length; p += 8) {
    const r = tr.push(to.slice(p, p + 8));
    if (at < 0 && r.ayah && r.ayah.surah === 108) at = p + 8 - 19;
  }
  assert.ok(at > 0 && at <= 32, `found after ${at} letters of al-Kawthar`);
});
