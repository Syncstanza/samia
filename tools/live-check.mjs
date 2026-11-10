// End-to-end check on real recitation audio, the same way the app runs:
// audio streamed in 0.6 s hops, model on the last 4 s, tracker.observe().
// Usage: node tools/live-check.mjs <labeled.json> <reciter> <maxClips> [gapSeconds]
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { QuranAsr } from '../src/engine/asr.js';
import { buildIndex } from '../src/engine/quran-index.js';
import { Tracker } from '../src/engine/tracker.js';

const SR = 16000, WINDOW = 4 * SR, HOP = 0.6 * SR;
const MODEL = new URL('../models/quran-asr-tiny/', import.meta.url);
ort.env.wasm.numThreads = 4;
const asr = await QuranAsr.load(ort, readFileSync(new URL('model.int8.onnx', MODEL)), readFileSync(new URL('tokens.txt', MODEL), 'utf8'));
const data = JSON.parse(readFileSync(new URL('../data/quran/quran.json', import.meta.url), 'utf8'));
const ix = buildIndex(data);

const [file, reciter, max = '60', gap = '0.8'] = process.argv.slice(2);
const clips = JSON.parse(readFileSync(file, 'utf8'))
  .filter((c) => c.reciter === reciter && c.ayah >= 0)
  .sort((a, b) => a.ayah - b.ayah)
  .slice(0, Number(max));

// One long recording with a short pause between ayat; truth per sample block.
const parts = [], truth = [];
for (const c of clips) {
  const b = readFileSync(c.file);
  const w = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  parts.push(w); truth.push({ n: w.length, ayah: c.ayah });
  const g = new Float32Array(Math.round(Number(gap) * SR));
  parts.push(g); truth.push({ n: g.length, ayah: c.ayah, gap: true });
}
const total = parts.reduce((s, p) => s + p.length, 0);
const audio = new Float32Array(total);
const label = new Int32Array(Math.ceil(total / HOP) + 1).fill(-1);
let off = 0;
for (let i = 0; i < parts.length; i++) {
  audio.set(parts[i], off);
  for (let s = off; s < off + parts[i].length; s += HOP) label[Math.floor(s / HOP)] = truth[i].ayah;
  off += parts[i].length;
}

const tr = new Tracker(ix);
const first = ix.ref(clips[0].ayah);
tr.setStart(first.surah, first.ayah); // volunteer set tonight's start
let start = 0, hops = 0, correct = 0, lag = 0, wrong = 0, blank = 0, slowest = 0;
const wrongs = [];
for (let end = HOP; end <= total; end += HOP) {
  const from = Math.max(start, end - WINDOW);
  const win = audio.subarray(from, end);
  const recent = audio.subarray(end - HOP, end);
  let rms = 0; for (const x of recent) rms += x * x; rms = Math.sqrt(rms / recent.length);
  let res;
  if (rms < 0.006) res = tr.observe('');
  else {
    const t = performance.now();
    res = tr.observe(await asr.transcribe(win), Math.min(1, HOP / win.length));
    slowest = Math.max(slowest, performance.now() - t);
  }
  if (res.clearAudio) start = end;
  const want = label[Math.floor((end - 1) / HOP)];
  const shown = res.ayah ? res.ayah.index : -1;
  hops++;
  if (shown === want) correct++;
  else if (shown < 0) blank++;
  else if (Math.abs(shown - want) <= 1 || (clips.findIndex((c) => c.ayah === want) > 0 && shown === clips[clips.findIndex((c) => c.ayah === want) - 1].ayah)) lag++; // still on the previous clip's ayah
  else { wrong++; if (wrongs.length < 6) wrongs.push(`${ix.ref(want).surah}:${ix.ref(want).ayah} shown ${res.ayah.surah}:${res.ayah.ayah}`); }
}
console.log(JSON.stringify({
  reciter, clips: clips.length, minutes: +(total / SR / 60).toFixed(1), hops,
  correctPct: +(correct / hops * 100).toFixed(1), lagPct: +(lag / hops * 100).toFixed(1),
  blankPct: +(blank / hops * 100).toFixed(1), wrongPct: +(wrong / hops * 100).toFixed(2),
  slowestHopMs: Math.round(slowest), wrongs,
}, null, 1));
