// End-to-end check on real recitation audio, through the same listening loop
// the app runs (src/engine/listener.js): audio arrives in 0.1 s pieces, at a
// laptop-mic level, with room hiss under it and in the pauses between ayat.
//
// Usage: node tools/live-check.mjs <labeled.json> <reciter> <maxClips> [hop] [window] [vad 0|1] [penalty]
//   labeled.json: [{file (16 kHz float32), ayah (global index), reciter}]
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { QuranAsr } from '../src/engine/asr.js';
import { buildIndex } from '../src/engine/quran-index.js';
import { Tracker } from '../src/engine/tracker.js';
import { Salah } from '../src/engine/salah.js';
import { Listener, SR } from '../src/engine/listener.js';

const MODEL = new URL('../models/quran-asr-tiny/', import.meta.url);
ort.env.wasm.numThreads = 4;
const asr = await QuranAsr.load(ort, readFileSync(new URL('model.int8.onnx', MODEL)), readFileSync(new URL('tokens.txt', MODEL), 'utf8'));
const data = JSON.parse(readFileSync(new URL('../data/quran/quran.json', import.meta.url), 'utf8'));
const ix = buildIndex(data);

const [file, reciter, max = '25', hop = '0.4', win = '3.5', vad = '1', penalty = ''] = process.argv.slice(2);
const clips = JSON.parse(readFileSync(file, 'utf8'))
  .filter((c) => c.reciter === reciter && c.ayah >= 0)
  .sort((a, b) => a.ayah - b.ayah)
  .slice(0, Number(max));

// Deterministic room hiss.
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const hiss = (n, rms) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = (rnd() + rnd() + rnd() - 1.5) * rms * 2; return a; };
const VOICE = 0.3, HISS = 0.004, GAP = 1.0;

// One long recording + the truth: which ayah and how far into it, per sample block.
const parts = [], marks = [];
let t = 0;
for (const c of clips) {
  const b = readFileSync(c.file);
  const w = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  const v = hiss(w.length, HISS);
  for (let i = 0; i < w.length; i++) v[i] += w[i] * VOICE;
  const prevAyah = marks.length ? marks[marks.length - 1].ayah : c.ayah - 1;
  parts.push(v); marks.push({ from: t, to: t + w.length, ayah: c.ayah, prev: prevAyah, afterGap: c.ayah !== prevAyah + 1 });
  t += w.length;
  parts.push(hiss(Math.round(GAP * SR), HISS)); t += Math.round(GAP * SR);
}
const audio = new Float32Array(t);
let off = 0;
for (const p of parts) { audio.set(p, off); off += p.length; }

const tr = new Tracker(ix, penalty === '' ? {} : { stepPenalty: Number(penalty), minIntoAyah: Number(penalty) ? 3 : 0 });
const salah = new Salah();
const first = ix.ref(clips[0].ayah);
tr.setStart(first.surah, first.ayah);
const listener = new Listener(asr, tr, salah, { hop: Number(hop), window: Number(win), minVoiced: vad === '1' ? 0.12 : 0 });

let hops = 0, correct = 0, lag = 0, wrong = 0, hlN = 0, hlErr = 0, hlAhead = 0, backMoves = 0, gapHops = 0, gapSpeech = 0;
let lastLetter = -1, lastShown = -1, slowest = 0;
const delays = [], delaysGap = [];
let mi = 0, waitingFor = -1, waitingSince = 0;
const PIECE = 1600;
for (let s = 0; s < audio.length; s += PIECE) {
  await listener.add(audio.subarray(s, Math.min(audio.length, s + PIECE)), (out) => {
    const now = s + PIECE;
    while (mi < marks.length - 1 && now > marks[mi].to + GAP * SR) mi++;
    const m = marks[mi];
    const inClip = now <= m.to;
    if (now >= m.from && waitingFor !== m.ayah && inClip && (out.ayah?.index ?? -1) !== m.ayah) { waitingFor = m.ayah; waitingSince = now; }
    const shown = out.ayah ? out.ayah.index : -1;
    if (waitingFor === m.ayah && shown === m.ayah) { (m.afterGap ? delaysGap : delays).push((now - waitingSince) / SR); waitingFor = -2; }
    slowest = Math.max(slowest, out.ms || 0);
    if (!inClip) { gapHops++; if (out.heard) gapSpeech++; return; }
    hops++;
    if (shown === m.ayah) {
      correct++;
      // Highlight vs. a steady-pace estimate of how far into the ayah he is.
      const len = ix.ayahStart[m.ayah + 1] - ix.ayahStart[m.ayah];
      const reached = ((now - m.from) / (m.to - m.from)) * len;
      const d = (out.letter || 0) - reached;
      hlN++; hlErr += Math.abs(d); if (d > 10) hlAhead++;
      if (shown === lastShown && out.letter < lastLetter - 2) backMoves++;
    } else if (shown >= 0 && (Math.abs(shown - m.ayah) <= 1 || shown === m.prev)) lag++; // still finishing the previous one
    else if (shown >= 0) wrong++;
    lastShown = shown; lastLetter = out.letter || 0;
  });
}
const avg = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null;
console.log(JSON.stringify({
  config: { hop: +hop, window: +win, vad: vad === '1', penalty: penalty === '' ? 'default' : +penalty },
  clips: clips.length, minutes: +(audio.length / SR / 60).toFixed(1),
  correctPct: +(correct / hops * 100).toFixed(1), nearbyPct: +(lag / hops * 100).toFixed(1), wrongPct: +(wrong / hops * 100).toFixed(2),
  newAyahSeconds: avg(delays), newAyahSecondsAfterSkip: avg(delaysGap),
  highlightErrLetters: +(hlErr / Math.max(1, hlN)).toFixed(1), highlightAheadPct: +(hlAhead / Math.max(1, hlN) * 100).toFixed(1),
  highlightBackMoves: backMoves,
  hissTreatedAsSpeechPct: +(gapSpeech / Math.max(1, gapHops) * 100).toFixed(1),
  slowestHopMs: slowest,
}));
