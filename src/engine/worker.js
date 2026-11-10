// Background worker: keeps the last few seconds of audio, runs the speech model
// on them every hop, and moves the verse tracker and the prayer position.
// The display thread only draws.
//
// Messages in:  {type:'init', modelUrl, tokensUrl, dataUrl, takbirUrl}
//               {type:'audio', samples: Float32Array (16 kHz)}
//               {type:'text', text}            (demo / testing without a model)
//               {type:'salah', istirahah}
//               {type:'start', surah, ayah} | {type:'next'} | {type:'prev'}
//               {type:'jump', index} | {type:'reset'}
// Messages out: {type:'ready', asr: boolean} | {type:'error', message}
//               {type:'update', state, ayah, letter, changed, salah, phase, heard, level}

import { buildIndex } from './quran-index.js';
import { Tracker } from './tracker.js';
import { QuranAsr } from './asr.js';
import { Salah } from './salah.js';
import { followHop } from './follow.js';
import { Utterances } from './utterances.js';

const SR = 16000;
const WINDOW = 4.0 * SR;   // seconds of audio the model looks at
const HOP = 0.6 * SR;      // how often it looks
const MIN_SPEECH_RMS = 0.0008; // absolute floor: quieter than this is silence
const TARGET_RMS = 0.05;       // quiet mics are boosted to about this level
const MAX_GAIN = 40;

let ix = null;
let tracker = null;
let takbirAyat = null;
let istirahah = false;
let salah = new Salah();
let asr = null;
let ring = new Float32Array(0);
let sinceHop = 0;
let busy = false;
let lastHeard = '';
const utterances = new Utterances(SR);

const post = (m) => self.postMessage(m);
const newSalah = () => new Salah({ takbirAyat, istirahah });

self.onmessage = async ({ data: msg }) => {
  try {
    switch (msg.type) {
      case 'init': return await init(msg);
      case 'audio': return onAudio(msg.samples);
      case 'text': {
        // Demo: typed text stands in for speech; '' = a silent moment.
        const utter = msg.utter || (msg.text ? { dur: 0.6, gapBefore: 0.1 } : null);
        return post({ type: 'update', ...followHop(tracker, salah, { text: msg.text, push: true, dt: 0.9, utter }), heard: msg.text, level: 0 });
      }
      case 'salah': istirahah = !!msg.istirahah; salah = newSalah(); return send(tracker._result(false));
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

async function init({ modelUrl, tokensUrl, dataUrl, takbirUrl }) {
  const data = await (await fetch(dataUrl)).json();
  ix = buildIndex(data);
  tracker = new Tracker(ix);
  try {
    const list = (await (await fetch(takbirUrl)).json()).ayat;
    takbirAyat = new Set(list.map(([s, a]) => ix.indexOf(s, a)).filter((i) => i >= 0));
  } catch { takbirAyat = null; }
  salah = newSalah();
  if (modelUrl) {
    try {
      const ort = await import('/vendor/ort/ort.wasm.min.mjs');
      ort.env.wasm.wasmPaths = '/vendor/ort/';
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
  utterances.add(samples);
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

    // Only true silence is skipped. Room noise is left to the model and the
    // tracker (noise gives few letters and no good match), because any level
    // threshold would also cut off a quiet mic or a soft-voiced imam.
    let out;
    if (level <= MIN_SPEECH_RMS) {
      lastHeard = '';
      out = followHop(tracker, salah, { text: '', dt: HOP / SR });
    } else {
      const started = performance.now();
      lastHeard = await asr.transcribe(withGain(ring));
      // How the latest stretch of speech was said (pause before it, length).
      const utter = utterances.latest();
      out = followHop(tracker, salah, { text: lastHeard, newFraction: Math.min(1, HOP / ring.length), dt: HOP / SR, utter });
      out.ms = Math.round(performance.now() - started);
    }
    if (out.clearAudio) ring = new Float32Array(0);
    post({ type: 'update', ...out, heard: lastHeard, level });
  } finally {
    busy = false;
  }
}

// Quiet mics (laptops, no auto gain) are scaled up so the model hears a normal level.
function withGain(wave) {
  let sum = 0;
  for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
  const rms = Math.sqrt(sum / Math.max(1, wave.length));
  const gain = Math.min(MAX_GAIN, TARGET_RMS / Math.max(rms, 1e-6));
  if (gain <= 1.2) return wave;
  const out = new Float32Array(wave.length);
  for (let i = 0; i < wave.length; i++) out[i] = Math.max(-1, Math.min(1, wave[i] * gain));
  return out;
}

// Manual moves and settings: show the result without stepping the prayer state.
function send(res) {
  const v = salah.view();
  post({ type: 'update', ...res, salah: v, phase: v.phase, heard: '', level: 0 });
}
