// Simulates recitation with a noisy speech model and scores the tracker.
//
// Several "sets": al-Fatiha, then the next stretch of a passage, with pauses
// and repeated ayat. Recognised letters are corrupted at a chosen error rate
// (much harsher than the real model) and fed in ~1 s chunks, or as a sliding
// window like the app (window > 0).
//
// Usage: node tools/simulate.mjs [errorRate=0.15] [sets=8] [seed=1] [start=2:142] [live] [cold] [noisy]

import { readFileSync } from 'node:fs';
import { buildIndex } from '../src/engine/quran-index.js';
import { Tracker } from '../src/engine/tracker.js';

export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';

export function simulate(data, {
  errorRate = 0.15, sets = 8, seed = 1, start = [2, 142], ayatPerSet = [6, 12], chunk = 12,
  cold = false, window = 0, roomNoise = 0, trackerOptions = {},
} = {}) {
  const ix = buildIndex(data);
  const rand = rng(seed);
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

  // 1. Script: segments { text (normalised), truth (ayah index, or -2 = pause) }
  const segs = [];
  const ayah = (i) => segs.push({ text: ix.letters.slice(ix.ayahStart[i], ix.ayahStart[i + 1]), truth: i });
  const pause = (n) => { for (let k = 0; k < n; k++) segs.push({ text: '', truth: -2 }); };
  let k = ix.indexOf(start[0], start[1]);
  for (let r = 0; r < sets; r++) {
    for (let f = 1; f <= 6; f++) { ayah(f); pause(rand() < 0.5 ? 1 : 0); }
    pause(2);
    const n = between(...ayatPerSet);
    for (let j = 0; j < n && k < ix.count; j++, k++) {
      ayah(k);
      if (rand() < 0.1 && j > 0) ayah(k); // the reciter repeats the ayah
      pause(between(0, 2));
    }
    pause(6);
  }

  // 2. Noisy recognition, chunked into pushes with the truth for each.
  const pushes = [];
  let lastTruth = -1;
  for (const seg of segs) {
    if (seg.truth === -2) {
      // Room noise that got past the silence detection: a few stray letters.
      const stray = rand() < roomNoise ? Array.from({ length: between(1, 4) }, () => LETTERS[between(0, LETTERS.length - 1)]).join('') : '';
      pushes.push({ text: stray, truth: lastTruth, kind: stray ? 'noise' : 'pause' });
      continue;
    }
    let noisy = '';
    for (const ch of seg.text) {
      const x = rand();
      if (x < errorRate / 3) continue;                                                               // deletion
      if (x < (2 * errorRate) / 3) { noisy += LETTERS[between(0, LETTERS.length - 1)]; continue; } // substitution
      noisy += ch;
      if (x < errorRate) noisy += LETTERS[between(0, LETTERS.length - 1)];                          // insertion
    }
    for (let p = 0; p < noisy.length; p += chunk) {
      lastTruth = seg.truth;
      const reached = Math.round(Math.min(1, (p + chunk) / noisy.length) * seg.text.length);
      pushes.push({ text: noisy.slice(p, p + chunk), truth: seg.truth, kind: 'quran', reached, first: p === 0 });
    }
  }

  // 3. Run the tracker.
  const tr = new Tracker(ix, trackerOptions);
  if (!cold) tr.setStart(start[0], start[1]); // cold = no start point set
  let quran = 0, correct = 0, lag = 0, wrong = 0, blank = 0, firstCorrect = -1;
  let hlCount = 0, hlBehind = 0, hlAhead = 0, newAyahAt = -1, showDelay = 0, showCount = 0;
  const wrongs = [];
  let audio = [];
  pushes.forEach((p, n) => {
    let res;
    if (window > 0) {
      audio.push(p.text);
      if (audio.length > window) audio.shift();
      // A silent hop is skipped before the model runs (as in the app).
      res = p.text ? tr.observe(audio.join(''), 1 / audio.length) : tr.observe('');
      if (res.clearAudio) audio = [];
    } else {
      res = tr.push(p.text);
    }
    if (p.kind !== 'quran') return;
    quran++;
    const shown = res.ayah ? res.ayah.index : -1;
    if (p.first) newAyahAt = n;
    if (shown === p.truth) {
      correct++; if (firstCorrect < 0) firstCorrect = n;
      const d = p.reached - (res.letter || 0);
      hlCount++; hlBehind += Math.max(0, d); if (d < -6) hlAhead++;
      if (newAyahAt >= 0) { showDelay += n - newAyahAt; showCount++; newAyahAt = -1; }
    } else if (shown < 0) blank++;
    // one ayah behind, or still on the previous part while switching into or out of al-Fatiha
    else if (Math.abs(shown - p.truth) === 1 || (p.truth <= 6 && shown <= 6) || (p.truth <= 6) !== (shown <= 6)) lag++;
    else { wrong++; if (wrongs.length < 200) wrongs.push({ n, truth: ix.ref(p.truth), shown: res.ayah }); }
  });

  const pct = (x) => +(x / quran * 100).toFixed(2);
  return {
    errorRate, sets, seed, pushes: pushes.length, quranPushes: quran,
    correct: pct(correct), lagByOne: pct(lag), blank: pct(blank), wrongVerse: pct(wrong),
    firstCorrectPush: firstCorrect,
    highlightBehindLetters: +(hlBehind / Math.max(1, hlCount)).toFixed(1),
    highlightAheadPct: +(hlAhead / Math.max(1, hlCount) * 100).toFixed(1),
    newAyahDelayPushes: +(showDelay / Math.max(1, showCount)).toFixed(2),
    endedAt: tr.shown >= 0 ? ix.ref(tr.shown) : null,
    expectedEnd: ix.ref(k - 1),
    wrongs,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = JSON.parse(readFileSync(new URL('../data/quran/quran.json', import.meta.url), 'utf8'));
  const [er = '0.15', st = '8', sd = '1', from = '2:142', ...modes] = process.argv.slice(2);
  const res = simulate(data, {
    errorRate: +er, sets: +st, seed: +sd, start: from.split(':').map(Number),
    cold: modes.includes('cold'), window: modes.includes('live') ? 4 : 0, roomNoise: modes.includes('noisy') ? 0.35 : 0,
  });
  delete res.wrongs;
  console.log(JSON.stringify(res, null, 2));
}
