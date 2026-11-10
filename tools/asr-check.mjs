// Runs the speech model (onnxruntime-web, same code path as the app) on 16 kHz
// float32 clips and reports letter accuracy and speed.
// Usage: node tools/asr-check.mjs <index.json> [limit]
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { QuranAsr } from '../src/engine/asr.js';
import { normalize } from '../src/engine/normalize.js';

const MODEL = new URL('../models/quran-asr-tiny/', import.meta.url);
ort.env.wasm.numThreads = 4;
const asr = await QuranAsr.load(ort, readFileSync(new URL('model.int8.onnx', MODEL)), readFileSync(new URL('tokens.txt', MODEL), 'utf8'));

function editDistance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

const [file, limit = '40'] = process.argv.slice(2);
const clips = JSON.parse(readFileSync(file, 'utf8')).slice(0, Number(limit));
let errs = 0, total = 0, audioSec = 0, ms = 0;
for (const c of clips) {
  const buf = readFileSync(c.file);
  const wave = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const t = performance.now();
  const heard = await asr.transcribe(wave);
  ms += performance.now() - t;
  audioSec += wave.length / 16000;
  const ref = normalize(c.text), hyp = normalize(heard);
  errs += editDistance(ref, hyp); total += ref.length;
}
console.log(JSON.stringify({ clips: clips.length, letterErrorPct: +(errs / total * 100).toFixed(1), audioMin: +(audioSec / 60).toFixed(1), realTimeFactor: +(ms / 1000 / audioSec).toFixed(3) }));
console.log('sample:', normalize(clips[0].text).slice(0, 60));
const b0 = readFileSync(clips[0].file);
console.log('heard :', normalize(await asr.transcribe(new Float32Array(b0.buffer, b0.byteOffset, b0.length / 4))).slice(0, 60));
