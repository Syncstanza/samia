// Simulates a night of taraweeh with a noisy speech model and scores the tracker.
//
// Each rak'ah: takbir, al-Fatiha (bismillah silent), "Ameen", then the next
// stretch of the khatm, with pauses, repeated ayat, then ruku' and sujud calls.
// Recognised letters are corrupted at a chosen error rate and fed in ~1 s chunks.
//
// Usage: node tools/simulate.mjs [errorRate=0.15] [rakahs=8] [seed=1] [start=2:142]

import { readFileSync } from 'node:fs';
import { buildIndex } from '../src/engine/quran-index.js';
import { normalize } from '../src/engine/normalize.js';
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
const CALLS = {
  takbir: 'الله اكبر',
  ameen: 'امين',
  ruku: 'الله اكبر',
  rise: 'سمع الله لمن حمده',
};

export function simulate(data, { errorRate = 0.15, rakahs = 8, seed = 1, start = [2, 142], ayatPerRakah = [6, 12], chunk = 12, cold = false } = {}) {
  const ix = buildIndex(data);
  const rand = rng(seed);
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

  // 1. Script: a list of segments { text (normalised), truth (ayah index or -1) }
  const segs = [];
  const quranAyah = (i) => {
    const s = ix.ayahStart[i], e = ix.ayahStart[i + 1];
    segs.push({ text: ix.letters.slice(s, e), truth: i });
  };
  const call = (t) => segs.push({ text: normalize(t), truth: -1 });
  const pause = (n) => { for (let k = 0; k < n; k++) segs.push({ text: '', truth: -2 }); };

  let k = ix.indexOf(start[0], start[1]);
  for (let r = 0; r < rakahs; r++) {
    call(CALLS.takbir); pause(2);
    for (let f = 1; f <= 6; f++) { quranAyah(f); pause(rand() < 0.5 ? 1 : 0); }
    call(CALLS.ameen); pause(2);
    const n = between(...ayatPerRakah);
    for (let j = 0; j < n && k < ix.count; j++, k++) {
      quranAyah(k);
      if (rand() < 0.1 && j > 0) quranAyah(k); // imam repeats the ayah
      pause(between(0, 2));
    }
    call(CALLS.ruku); pause(6); call(CALLS.rise); pause(8);
  }

  // 2. Noisy recognition, chunked into pushes with a truth label per push.
  const pushes = [];
  let lastTruth = -1;
  for (const seg of segs) {
    if (seg.truth === -2) { pushes.push({ text: '', truth: lastTruth, kind: 'pause' }); continue; }
    let noisy = '';
    for (const ch of seg.text) {
      const x = rand();
      if (x < errorRate / 3) continue;                                            // deletion
      if (x < (2 * errorRate) / 3) { noisy += LETTERS[between(0, LETTERS.length - 1)]; continue; } // substitution
      noisy += ch;
      if (x < errorRate) noisy += LETTERS[between(0, LETTERS.length - 1)];          // insertion
    }
    for (let p = 0; p < noisy.length; p += chunk) {
      if (seg.truth >= 0) lastTruth = seg.truth;
      pushes.push({ text: noisy.slice(p, p + chunk), truth: seg.truth >= 0 ? seg.truth : lastTruth, kind: seg.truth >= 0 ? 'quran' : 'call' });
    }
  }

  // 3. Run the tracker. Start point is set, like a volunteer would.
  const tr = new Tracker(ix);
  if (!cold) tr.setStart(start[0], start[1]); // cold = nobody set tonight's start
  let quran = 0, correct = 0, lag = 0, wrong = 0, blank = 0, held = 0, firstCorrect = -1;
  const wrongs = [];
  pushes.forEach((p, n) => {
    const res = tr.push(p.text);
    if (p.kind !== 'quran') return;
    quran++;
    const shown = res.ayah ? res.ayah.index : -1;
    if (shown === p.truth) { correct++; if (firstCorrect < 0) firstCorrect = n; }
    else if (shown < 0) blank++;
    else if (shown === p.truth - 1 || shown === p.truth + 1 || (p.truth <= 6 && shown <= 6)) lag++;
    // Screen still on the previous part during a switch into or out of al-Fatiha.
    else if ((p.truth <= 6 && shown > 6) || (p.truth > 6 && shown === 6)) held++;
    else { wrong++; if (wrongs.length < 200) wrongs.push({ n, truth: ix.ref(p.truth), shown: res.ayah }); }
  });

  return {
    errorRate, rakahs, seed, pushes: pushes.length, quranPushes: quran,
    correct: +(correct / quran * 100).toFixed(1),
    lagByOne: +(lag / quran * 100).toFixed(1),
    blank: +(blank / quran * 100).toFixed(1),
    heldDuringFatihaSwitch: +(held / quran * 100).toFixed(1),
    wrongVerse: +(wrong / quran * 100).toFixed(2),
    firstCorrectPush: firstCorrect,
    endedAt: tr.shown >= 0 ? ix.ref(tr.shown) : null,
    expectedEnd: ix.ref(k - 1),
    wrongs,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = JSON.parse(readFileSync(new URL('../data/quran/quran.json', import.meta.url), 'utf8'));
  const [er = '0.15', rk = '8', sd = '1', st = '2:142', mode = ''] = process.argv.slice(2);
  const res = simulate(data, { errorRate: +er, rakahs: +rk, seed: +sd, start: st.split(':').map(Number), cold: mode === 'cold' });
  console.log(JSON.stringify(res, null, 2));
}
