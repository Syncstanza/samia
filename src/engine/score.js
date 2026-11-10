// Scoring a recitation of a chosen passage (competition and hifz test).
//
// At the end of a turn the whole recording is split at the reciter's pauses,
// each piece is run through the speech model, and everything heard is lined
// up against the passage letter by letter. Each word is then:
//   correct   heard (allowing for the speech model's own small errors)
//   mistake   heard, but too different from the word
//   skipped   nothing heard for it, though the reciter went on past it
//   unread    after the point where the reciter stopped
// Score = correct words / all words in the passage.

import { normalize } from './normalize.js';
import { SR } from './listener.js';
import { gain } from './listener.js';

/**
 * The passage from global ayah index `from` to `to` (inclusive), as words.
 * Words are split exactly as the display splits them, so marks line up.
 */
export function buildPassage(data, from, to) {
  const words = [];
  let letters = '';
  for (let i = from; i <= to; i++) {
    const [s, a, ar] = data.ayat[i];
    let parts = ar.split(' ');
    if (a === 1 && data.surahs[s - 1].bismillahPrefix) parts = parts.slice(4); // shown as a heading
    parts.forEach((text, k) => {
      const norm = normalize(text);
      words.push({ ayah: i, k, text, norm, start: letters.length, end: letters.length + norm.length });
      letters += norm;
    });
  }
  return { from, to, words, letters };
}

const MATCH = 2, MISMATCH = -1, GAP = -1;

/**
 * Line up what was heard against the passage. Free of charge:
 *   - anything said BEFORE the passage (a'udhu billah, bismillah, chatter),
 *   - anything said AFTER it (carrying on past the last ayah),
 *   - stopping early (the rest of the passage is then "unread").
 * Garbled or extra letters inside the recitation cost a little.
 * Returns per-passage-letter flags (1 = heard exactly, 2 = heard as another
 * letter, 0 = not heard) and how far into the passage the reciter got.
 */
export function alignHeard(heard, ref) {
  const H = heard.length, R = ref.length;
  const W = R + 1;
  let prev = new Int32Array(W), cur = new Int32Array(W);
  const dir = new Uint8Array((H + 1) * W); // 1 diag, 2 up (extra heard letter), 3 left (passage letter not heard)
  for (let j = 1; j <= R; j++) { prev[j] = prev[j - 1] + GAP; dir[j] = 3; }
  let bestEnd = { score: -Infinity, i: 0, j: 0 };
  for (let i = 1; i <= H; i++) {
    cur[0] = 0; dir[i * W] = 2; // heard letters before the passage are free
    const hc = heard.charCodeAt(i - 1);
    for (let j = 1; j <= R; j++) {
      const d = prev[j - 1] + (ref.charCodeAt(j - 1) === hc ? MATCH : MISMATCH);
      const u = prev[j] + GAP;
      const l = cur[j - 1] + GAP;
      if (d >= u && d >= l) { cur[j] = d; dir[i * W + j] = 1; }
      else if (l >= u) { cur[j] = l; dir[i * W + j] = 3; }
      else { cur[j] = u; dir[i * W + j] = 2; }
    }
    // Passage finished here; whatever follows in what was heard is free.
    if (cur[R] > bestEnd.score) bestEnd = { score: cur[R], i, j: R };
    [prev, cur] = [cur, prev];
  }
  // Or all of it heard, stopping somewhere inside the passage.
  for (let j = 0; j <= R; j++) if (prev[j] > bestEnd.score) bestEnd = { score: prev[j], i: H, j };

  const flags = new Uint8Array(R);
  let i = bestEnd.i, j = bestEnd.j;
  const bestJ = j;
  while (i > 0 || j > 0) {
    const d = dir[i * W + j];
    if (j === 0) break; // the rest of what was heard came before the passage
    if (d === 1) { flags[j - 1] = heard[i - 1] === ref[j - 1] ? 1 : 2; i--; j--; }
    else if (d === 3 || i === 0) { j--; }
    else { i--; }
  }
  return { flags, reached: bestJ };
}

/** Allowed letter errors in a word before it counts as a mistake. */
function tolerance(len) {
  if (len <= 2) return 0;
  if (len <= 5) return 1;
  return Math.floor(len * 0.25);
}

/** Mark every word of the passage from the letters heard, and score. */
export function scoreHeard(passage, heard) {
  const { flags, reached } = alignHeard(heard, passage.letters);
  let correct = 0, read = 0;
  const marks = passage.words.map((w) => {
    if (w.start >= reached) return 'unread';
    read++;
    let exact = 0;
    for (let k = w.start; k < w.end; k++) if (flags[k] === 1) exact++;
    const len = w.end - w.start;
    if (len - exact <= tolerance(len)) { correct++; return 'correct'; }
    // A third or less of it heard: a few letters lined up by chance, the word
    // itself wasn't said.
    return exact * 3 <= len ? 'skipped' : 'mistake';
  });
  const total = passage.words.length;
  return {
    marks,
    correct,
    total,
    read,
    score: total ? Math.round((correct / total) * 1000) / 10 : 0,       // of the whole passage
    accuracy: read ? Math.round((correct / read) * 1000) / 10 : 0,       // of what was recited
    reachedAyah: reached ? passage.words.findLast((w) => w.start < reached).ayah : passage.from,
  };
}

/**
 * Split a recording at pauses (and long stretches at their quietest moment),
 * so each piece is a sensible size for the speech model.
 * Returns [[startSample, endSample], ...].
 */
export function splitAtPauses(audio, { maxPiece = 10, minPause = 0.25 } = {}) {
  const FRAME = 320; // 20 ms
  const n = Math.floor(audio.length / FRAME);
  const lv = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) s += audio[i] * audio[i];
    lv[f] = Math.sqrt(s / FRAME);
  }
  const sorted = Float32Array.from(lv).sort();
  const floor = sorted[Math.floor(n * 0.1)] || 0;
  const silentLv = Math.max(0.0015, floor * 3);
  const silent = (f) => lv[f] <= silentLv;

  // pieces of voice separated by pauses of at least minPause
  const pieces = [];
  let start = -1, quiet = 0;
  const minQuiet = Math.round(minPause / 0.02);
  for (let f = 0; f < n; f++) {
    if (!silent(f)) { if (start < 0) start = f; quiet = 0; }
    else if (start >= 0 && ++quiet >= minQuiet) { pieces.push([start, f - quiet + 1]); start = -1; quiet = 0; }
  }
  if (start >= 0) pieces.push([start, n]);

  // long pieces: cut at the quietest frame between 60% and 100% of maxPiece
  const maxF = Math.round(maxPiece / 0.02);
  const out = [];
  for (let [a, b] of pieces) {
    while (b - a > maxF) {
      let cut = a + Math.round(maxF * 0.6), best = Infinity;
      for (let f = a + Math.round(maxF * 0.6); f < a + maxF; f++) if (lv[f] < best) { best = lv[f]; cut = f; }
      out.push([a, cut]); a = cut;
    }
    out.push([a, b]);
  }
  const pad = 0.1 * SR;
  return out.map(([a, b]) => [Math.max(0, a * FRAME - pad), Math.min(audio.length, b * FRAME + pad)]);
}

/** Transcribe a whole turn piece by piece; returns the letters heard, in order. */
export async function transcribeTurn(asr, audio, onProgress = () => {}) {
  let heard = '';
  const pieces = splitAtPauses(audio);
  for (const [n, [a, b]] of pieces.entries()) {
    onProgress(n / pieces.length);
    const piece = audio.subarray(a, b);
    let s = 0;
    for (let i = 0; i < piece.length; i++) s += piece[i] * piece[i];
    const level = Math.sqrt(s / Math.max(1, piece.length)) * 1.4;
    heard += normalize(await asr.transcribe(gain(piece, level)));
  }
  return heard;
}
