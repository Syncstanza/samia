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
import { Listener } from './listener.js';

let ix = null;
let tracker = null;
let takbirAyat = null;
let istirahah = false;
let salah = new Salah();
let asr = null;
let listener = null;

const post = (m) => self.postMessage(m);
const newSalah = () => new Salah({ takbirAyat, istirahah });
const clearAudio = () => listener && listener.clearAudio();

self.onmessage = async ({ data: msg }) => {
  try {
    switch (msg.type) {
      case 'init': return await init(msg);
      case 'audio': return listener && listener.add(msg.samples, (out) => post({ type: 'update', ...out }));
      case 'text': {
        // Demo: typed text stands in for speech; '' = a silent moment.
        const utter = msg.utter || (msg.text ? { dur: 0.6, gapBefore: 0.1 } : null);
        return post({ type: 'update', ...followHop(tracker, salah, { text: msg.text, push: true, dt: 0.9, utter }), heard: msg.text, level: 0 });
      }
      case 'salah':
        istirahah = !!msg.istirahah; salah = newSalah();
        if (listener) listener.salah = salah;
        return send(tracker._result(false));
      case 'start': tracker.setStart(msg.surah, msg.ayah); clearAudio(); return send(tracker._result(true));
      case 'next': clearAudio(); return send(tracker.next());
      case 'prev': clearAudio(); return send(tracker.prev());
      case 'jump': clearAudio(); return send(tracker.jumpTo(msg.index));
      case 'reset': tracker.reset(); clearAudio(); return send(tracker._result(true));
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
      listener = new Listener(asr, tracker, salah);
    } catch (e) {
      post({ type: 'error', message: `Speech model not loaded: ${e.message}` });
    }
  }
  post({ type: 'ready', asr: !!asr });
}

// Manual moves and settings: show the result without stepping the prayer state.
function send(res) {
  const v = salah.view();
  post({ type: 'update', ...res, salah: v, phase: v.phase, heard: '', level: 0 });
}
