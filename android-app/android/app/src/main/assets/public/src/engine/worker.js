// Background worker: listens, follows the reciter, and scores turns.
// The display thread only draws.
//
// Messages in:  {type:'init', modelUrl, tokensUrl, dataUrl}
//               {type:'audio', samples: Float32Array (16 kHz)}
//               {type:'text', text}                 (demo / testing without a model)
//               {type:'start', surah, ayah} | {type:'next'} | {type:'prev'} | {type:'jump', index} | {type:'reset'}
//               {type:'turnStart', from, to}        (global ayah indices of the passage)
//               {type:'turnStart', free: true}      (hifz from anywhere: found like free recite)
//               {type:'turnEnd', score}             (stop the turn; score it unless score === false)
// Messages out: {type:'ready', asr} | {type:'error', message}
//               {type:'update', state, ayah, letter, changed, heard, level}
//               {type:'scoring', progress} | {type:'score', result}

import { buildIndex } from './quran-index.js';
import { Tracker } from './tracker.js';
import { QuranAsr } from './asr.js';
import { Listener } from './listener.js';
import { buildPassage, scoreHeard, transcribeTurn } from './score.js';
import { normalize } from './normalize.js';

let data = null;
let ix = null;
let tracker = null;
let asr = null;
let listener = null;
let turn = null;      // {from, to} while a turn is running
let demoHeard = '';   // demo mode: text "heard" during a turn

const post = (m) => self.postMessage(m);
const clearAudio = () => listener && listener.clearAudio();
const send = (res) => post({ type: 'update', ...res, heard: '', level: 0 });

self.onmessage = async ({ data: msg }) => {
  try {
    switch (msg.type) {
      case 'init': return await init(msg);
      case 'audio': return listener && listener.add(msg.samples, (out) => { noteReached(out); post({ type: 'update', ...out }); });
      case 'text':
        if (turn) demoHeard += normalize(msg.text);
        { const out = tracker.push(msg.text); noteReached(out); return post({ type: 'update', ...out, heard: msg.text, level: 0 }); }
      case 'start': tracker.setStart(msg.surah, msg.ayah); clearAudio(); return send(tracker._result(true));
      case 'next': clearAudio(); return send(tracker.next());
      case 'prev': clearAudio(); return send(tracker.prev());
      case 'jump': clearAudio(); return send(tracker.jumpTo(msg.index));
      case 'reset': tracker.reset(); clearAudio(); return send(tracker._result(true));
      case 'turnStart': {
        demoHeard = '';
        if (msg.free) {
          // From anywhere: no passage yet. It's found like free recite, and the
          // turn is scored over the ayat actually recited.
          turn = { free: true, first: -1, last: -1 };
          tracker.setBounds(null);
          tracker.reset();
          clearAudio();
          if (listener) listener.startRecording();
          return send(tracker._result(true));
        }
        turn = { from: msg.from, to: msg.to };
        const r = ix.ref(msg.from);
        tracker.setStart(r.surah, r.ayah);
        tracker.setBounds(msg.from, msg.to);
        clearAudio();
        if (listener) listener.startRecording();
        return send(tracker._result(true));
      }
      case 'turnEnd': return await endTurn(msg.score !== false);
    }
  } catch (e) {
    post({ type: 'error', message: String(e && e.message || e) });
  }
};

async function init({ modelUrl, tokensUrl, dataUrl }) {
  data = await (await fetch(dataUrl)).json();
  ix = buildIndex(data);
  tracker = new Tracker(ix);
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
      listener = new Listener(asr, tracker);
    } catch (e) {
      post({ type: 'error', message: `Speech model not loaded: ${e.message}` });
    }
  }
  post({ type: 'ready', asr: !!asr });
}

// Hifz from anywhere: the first ayah followed and the furthest one reached.
function noteReached(out) {
  if (!turn || !turn.free || !out.ayah || tracker.state !== 'LOCKED') return;
  const i = out.ayah.index;
  if (turn.first < 0) turn.first = i;
  turn.last = Math.max(turn.last, i);
}

async function endTurn(score = true) {
  if (!turn) return;
  if (!score) { // judged competition (or left the turn): nothing to score
    turn = null;
    tracker.setBounds(null);
    if (listener) listener.stopRecording();
    return;
  }
  if (turn.free) return endFreeTurn();
  const { from, to } = turn;
  turn = null;
  tracker.setBounds(null);
  const passage = buildPassage(data, from, to);
  let heard = demoHeard;
  if (listener) {
    const audio = listener.stopRecording();
    post({ type: 'scoring', progress: 0 });
    heard = await transcribeTurn(asr, audio, (p) => post({ type: 'scoring', progress: p }));
  }
  const result = scoreHeard(passage, heard);
  post({ type: 'score', result: { ...result, from, to, words: passage.words.map((w) => ({ ayah: w.ayah, k: w.k, text: w.text })) } });
}

async function endFreeTurn() {
  const { first, last } = turn;
  turn = null;
  // The ayat recited are only known now; the scoring below is the same as for
  // a chosen passage.
  let heard = demoHeard;
  if (listener) {
    const audio = listener.stopRecording();
    if (first < 0) return post({ type: 'score', result: { none: true } });
    post({ type: 'scoring', progress: 0 });
    heard = await transcribeTurn(asr, audio, (p) => post({ type: 'scoring', progress: p }));
  }
  if (first < 0) return post({ type: 'score', result: { none: true } });
  // It finds the place a little after the reciter starts, so the first ayah or
  // two may come before the one it found first: include them if they were
  // clearly recited (most of their words correct).
  let from = first;
  for (const back of [2, 1]) {
    const f = first - back;
    if (f < 0) continue;
    const p = buildPassage(data, f, last);
    const r = scoreHeard(p, heard);
    const mine = p.words.map((w, k) => [w, r.marks[k]]).filter(([w]) => w.ayah < first);
    if (mine.length && mine.filter(([, m]) => m === 'correct').length >= mine.length * 0.6) { from = f; break; }
  }
  const passage = buildPassage(data, from, last);
  const result = scoreHeard(passage, heard);
  post({ type: 'score', result: { ...result, from, to: last, words: passage.words.map((w) => ({ ayah: w.ayah, k: w.k, text: w.text })) } });
}
