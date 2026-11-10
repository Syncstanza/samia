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
import { Salah } from '../src/engine/salah.js';
import { followHop } from '../src/engine/follow.js';

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
  tasmi: 'سمع الله لمن حمده',
  tahmid: 'ربنا ولك الحمد',
  salam: 'السلام عليكم ورحمة الله',
};

export function simulate(data, { errorRate = 0.15, rakahs = 8, seed = 1, start = [2, 142], ayatPerRakah = [6, 12], chunk = 12, cold = false, window = 0, debug = false, takbirAyat = null, stretchedShare = 0.7 } = {}) {
  const ix = buildIndex(data);
  const rand = rng(seed);
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

  // 1. Script: a list of segments { text (normalised), truth (ayah index or -1) }
  const segs = [];
  let pos = 'QIYAM';
  const quranAyah = (i) => {
    const s = ix.ayahStart[i], e = ix.ayahStart[i + 1];
    segs.push({ text: ix.letters.slice(s, e), truth: i, pos });
  };
  const call = (t) => segs.push({ text: normalize(t), truth: -1, pos });
  const pause = (n) => { for (let k = 0; k < n; k++) segs.push({ text: '', truth: -2, pos }); };
  const at = (p) => { pos = p; };

  let k = ix.indexOf(start[0], start[1]);
  for (let r = 0; r < rakahs; r++) {
    const first = r % 2 === 0; // taraweeh: sets of two rak'ahs
    at('QIYAM');
    if (first) { call(CALLS.takbir); pause(4); } // opening takbir, silent opening dua
    for (let f = 1; f <= 6; f++) { quranAyah(f); pause(rand() < 0.5 ? 1 : 0); }
    call(CALLS.ameen); pause(2);
    const n = between(...ayatPerRakah);
    for (let j = 0; j < n && k < ix.count; j++, k++) {
      quranAyah(k);
      if (rand() < 0.1 && j > 0) quranAyah(k); // imam repeats the ayah
      pause(between(0, 2));
    }
    // Each call is labelled with the position it moves into.
    at('RUKU'); call(CALLS.takbir); pause(5);
    at('QAWMAH'); call(CALLS.tasmi); call(CALLS.tahmid); pause(2);
    at('SUJOOD_1'); call(CALLS.takbir); pause(5);
    at('JALSAH'); call(CALLS.takbir); pause(2);
    at('SUJOOD_2'); call(CALLS.takbir); pause(5);
    if (first) { at('RISING'); call(CALLS.takbir); pause(2); }
    else { at('TASHAHHUD'); call(CALLS.takbir); pause(10); at('SALAM'); call(CALLS.salam); call(CALLS.salam); pause(4); }
  }

  // 2. Noisy recognition, chunked into pushes with a truth label per push.
  const pushes = [];
  let lastTruth = -1;
  for (const seg of segs) {
    if (seg.truth === -2) { pushes.push({ text: '', truth: lastTruth, kind: 'pause', pos: seg.pos }); continue; }
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
      pushes.push({ text: noisy.slice(p, p + chunk), truth: seg.truth >= 0 ? seg.truth : lastTruth, kind: seg.truth >= 0 ? 'quran' : 'call', pos: seg.pos });
    }
  }

  // 3. Run the tracker. Start point is set, like a volunteer would.
  const tr = new Tracker(ix);
  const risky = takbirAyat ? new Set(takbirAyat.map(([s, a]) => ix.indexOf(s, a))) : null;
  const salah = new Salah({ takbirAyat: risky });
  let posOk = 0, posTotal = 0, falseRuku = 0, prevTruthPos = 'QIYAM', sinceChange = 0, prevShownPos = 'QIYAM';
  const posWrongs = [];
  if (!cold) tr.setStart(start[0], start[1]); // cold = nobody set tonight's start
  let quran = 0, correct = 0, lag = 0, wrong = 0, blank = 0, held = 0, firstCorrect = -1;
  const wrongs = [];
  // window > 0: live mode. Each hop the tracker sees the transcript of the last
  // `window` hops of audio (like the real app), not just the new letters.
  let audio = [];
  let prevKind = 'pause', utter = null;
  pushes.forEach((p, n) => {
    // How it was said: recitation runs on; a call after a pause is its own
    // utterance, drawn out most of the time (stretchedShare).
    if (p.kind === 'pause') utter = utter && { ...utter, gapAfter: (utter.gapAfter || 0) + 0.8 };
    else if (prevKind !== p.kind || prevKind === 'pause') {
      const gapBefore = prevKind === 'pause' ? 0.4 + rand() * 0.6 : 0.05;
      const dur = p.kind === 'call' ? (rand() < stretchedShare ? 1.0 + rand() * 1.2 : 0.55 + rand() * 0.2) : 3;
      utter = { dur, gapBefore, gapAfter: 0 };
    }
    prevKind = p.kind;

    let res;
    if (window > 0) {
      audio.push(p.text);
      if (audio.length > window) audio.shift();
      // A silent hop is skipped before the model runs (as in the worker).
      res = followHop(tr, salah, p.text ? { text: audio.join(''), newFraction: 1 / audio.length, dt: 0.8, utter } : { text: '', dt: 0.8 });
      if (res.clearAudio) audio = [];
    } else {
      res = followHop(tr, salah, { text: p.text, push: true, dt: 0.8, utter: p.text ? utter : null });
    }
    // Prayer position: allow 3 pushes (~2 s) after each change to catch up.
    const view = res.salah;
    if (debug && (p.kind !== 'quran' || res.call)) console.log(n, p.pos.padEnd(9), JSON.stringify(p.text).padEnd(18), String(res.call || '').padEnd(7), view.position, res.progressed ? 'progressed' : '');
    if (p.pos !== prevTruthPos) { prevTruthPos = p.pos; sinceChange = 0; } else sinceChange++;
    if (view.position === 'RUKU' && prevShownPos !== 'RUKU' && p.pos === 'QIYAM') {
      falseRuku++;
      if (debug) console.log('FALSE RUKU at push', n);
    }
    prevShownPos = view.position;
    if (sinceChange >= 3) {
      posTotal++;
      // "Standing for the next rak'ah" before al-Fatiha is recognised counts as standing.
      if (view.position === p.pos || (p.pos === 'QIYAM' && view.position === 'RISING')) posOk++;
      else if (posWrongs.length < 8) posWrongs.push(`${p.pos} shown ${view.position}`);
    }
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
    positionCorrect: +(posOk / posTotal * 100).toFixed(1),
    falseRuku,
    posWrongs,
    firstCorrectPush: firstCorrect,
    endedAt: tr.shown >= 0 ? ix.ref(tr.shown) : null,
    expectedEnd: ix.ref(k - 1),
    wrongs,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = JSON.parse(readFileSync(new URL('../data/quran/quran.json', import.meta.url), 'utf8'));
  const [er = '0.15', rk = '8', sd = '1', st = '2:142', ...modes] = process.argv.slice(2);
  const takbirAyat = JSON.parse(readFileSync(new URL('../data/takbir-ayat.json', import.meta.url), 'utf8')).ayat;
  const res = simulate(data, { errorRate: +er, rakahs: +rk, seed: +sd, start: st.split(':').map(Number),
    cold: modes.includes('cold'), window: modes.includes('live') ? 4 : 0, takbirAyat,
    stretchedShare: modes.includes('quick') ? 0 : 0.7 });
  console.log(JSON.stringify(res, null, 2));
}
