// Background worker: keeps the last few seconds of audio, runs the speech model
// on them every hop, and moves the tracker. The display thread only draws.
//
// Messages in:  {type:'init', modelUrl, tokensUrl, dataUrl}
//               {type:'audio', samples: Float32Array (16 kHz)}
//               {type:'text', text}            (demo / testing without a model)
//               {type:'start', surah, ayah} | {type:'next'} | {type:'prev'}
//               {type:'jump', index} | {type:'reset'}
// Messages out: {type:'ready', asr: boolean} | {type:'error', message}
//               {type:'update', state, ayah, changed, confidence, heard, level}

import { buildIndex } from './quran-index.js';
import { Tracker } from './tracker.js';
import { QuranAsr } from './asr.js';

const SR = 16000;
const WINDOW = 4.0 * SR;   // seconds of audio the model looks at
const HOP = 0.6 * SR;      // how often it looks
const SILENCE_RMS = 0.006; // below this a hop counts as silence

let tracker = null;
let asr = null;
let ring = new Float32Array(0);
let sinceHop = 0;
let busy = false;
let lastHeard = '';

const post = (m) => self.postMessage(m);

self.onmessage = async ({ data: msg }) => {
  try {
    switch (msg.type) {
      case 'init': return await init(msg);
      case 'audio': return onAudio(msg.samples);
      case 'text': return send(tracker.push(msg.text), msg.text);
      case 'start': tracker.setStart(msg.surah, msg.ayah); ring = new Float32Array(0); return send(tracker._result(true));
      case 'next': ring = new Float32Array(0); return send(tracker.next());
      case 'prev': ring = new Float32Array(0); return send(tracker.prev());
      case 'jump': ring = new Float32Array(0); return send(tracker.jumpTo(msg.index));
      case 'reset': tracker.reset(); ring = new Float32Array(0); return send(tracker._result(true));
    }
  } catch (e) {
    post({ type: 'error', message: String(e && e.message || e) });
  }
};

async function init({ modelUrl, tokensUrl, dataUrl }) {
  const data = await (await fetch(dataUrl)).json();
  tracker = new Tracker(buildIndex(data));
  if (modelUrl) {
    try {
      const ort = await import('/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs');
      ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      const [model, tokens] = await Promise.all([
        fetch(modelUrl).then((r) => { if (!r.ok) throw new Error('model not found'); return r.arrayBuffer(); }),
        fetch(tokensUrl).then((r) => r.text()),
      ]);
      asr = await QuranAsr.load(ort, new Uint8Array(model), tokens, { executionProviders: ['wasm'] });
    } catch (e) {
      post({ type: 'error', message: `Speech model not loaded: ${e.message}` });
    }
  }
  post({ type: 'ready', asr: !!asr });
}

function onAudio(samples) {
  if (!asr) return;
  const next = new Float32Array(Math.min(WINDOW, ring.length + samples.length));
  const keep = next.length - samples.length;
  if (keep > 0) next.set(ring.subarray(ring.length - keep));
  next.set(samples.subarray(Math.max(0, samples.length - next.length)), Math.max(0, keep));
  ring = next;
  sinceHop += samples.length;
  if (sinceHop >= HOP && !busy) {
    sinceHop = 0;
    hop();
  }
}

async function hop() {
  busy = true;
  try {
    const recent = ring.subarray(Math.max(0, ring.length - HOP));
    let sum = 0;
    for (let i = 0; i < recent.length; i++) sum += recent[i] * recent[i];
    const level = Math.sqrt(sum / Math.max(1, recent.length));

    let res;
    if (level < SILENCE_RMS) {
      res = tracker.observe('');
      lastHeard = '';
    } else {
      const started = performance.now();
      lastHeard = await asr.transcribe(ring);
      res = tracker.observe(lastHeard, Math.min(1, HOP / ring.length));
      res.ms = Math.round(performance.now() - started);
    }
    if (res.clearAudio) ring = new Float32Array(0);
    send(res, lastHeard, level);
  } finally {
    busy = false;
  }
}

function send(res, heard = '', level = 0) {
  post({ type: 'update', ...res, heard, level });
}
