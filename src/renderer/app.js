// Display thread: draws the ayat and handles keys. The listening and matching
// happen in the worker (src/engine/worker.js) so drawing never stutters.
//
// URL options (handy for testing):
//   ?demo=2:255-2:257   play these ayat through the tracker without a model
//   ?start=2:142        set tonight's start point

import { startCapture, listInputs, micError } from './capture.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const MODEL = '/models/quran-asr-tiny/';

const store = {
  get(k, d) { try { const v = localStorage.getItem('samia.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('samia.' + k, JSON.stringify(v)); } catch { /* storage off */ } },
};

const data = await fetch('/data/quran/quran.json').then((r) => r.json());
const worker = new Worker('/src/engine/worker.js', { type: 'module' });
let shown = -1;
let asrReady = false;
let capture = null;

// ------------------------------------------------------------------ drawing
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);

function ayahParts(index) {
  const [s, a, ar, tr] = data.ayat[index];
  let text = ar;
  let bismillah = false;
  if (a === 1 && data.surahs[s - 1].bismillahPrefix) {
    text = ar.split(' ').slice(4).join(' '); // shown separately as a heading
    bismillah = true;
  }
  return { s, a, text, tr, bismillah };
}

function fill(el, index, { full }) {
  el.replaceChildren();
  if (index < 0 || index >= data.ayat.length) return;
  const p = ayahParts(index);
  if (full && p.bismillah) {
    const b = document.createElement('div');
    b.className = 'bismillah';
    b.textContent = data.bismillah;
    el.append(b);
  }
  const ar = document.createElement('p');
  ar.className = 'ar';
  ar.textContent = p.text + ' ';
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = '۝' + arNum(p.a);
  ar.append(num);
  el.append(ar);
  if (full) {
    const tr = document.createElement('p');
    tr.className = 'tr';
    tr.textContent = p.tr;
    el.append(tr);
  }
}

function fit() {
  // Largest Arabic size that fits the middle area (long ayat get smaller).
  const box = $('current');
  const vh = window.innerHeight / 100;
  let lo = 2.6 * vh, hi = 8.5 * vh;
  for (let k = 0; k < 9; k++) {
    const mid = (lo + hi) / 2;
    box.style.setProperty('--ar-size', `${mid}px`);
    box.style.setProperty('--tr-size', `${Math.max(1.5 * vh, Math.min(3.2 * vh, mid * 0.4))}px`);
    if (box.scrollHeight <= box.clientHeight + 1) lo = mid; else hi = mid;
  }
  box.style.setProperty('--ar-size', `${lo}px`);
  box.style.setProperty('--tr-size', `${Math.max(1.5 * vh, Math.min(3.2 * vh, lo * 0.4))}px`);
}

async function render(index) {
  if (index === shown || index < 0) return;
  const dir = shown < 0 ? 'fade-in' : index > shown ? 'enter-fwd' : 'enter-back';
  shown = index;
  try { await document.fonts.load('40px "Amiri Quran"', 'بسم'); } catch { /* fit again later */ }
  if (index !== shown) return; // a newer ayah arrived meanwhile
  fill($('prev'), index - 1, { full: false });
  fill($('current'), index, { full: true });
  fill($('next'), index + 1, { full: false });
  fit();
  for (const id of ['prev', 'current', 'next']) {
    const el = $(id);
    el.classList.remove('enter-fwd', 'enter-back', 'fade-in');
    void el.offsetWidth; // restart the animation
    el.classList.add(dir);
  }
  const [s, a] = data.ayat[index];
  const surah = data.surahs[s - 1];
  $('surahAr').textContent = surah.name;
  $('surahEn').textContent = `${surah.translit} · ${s}:${a}`;
  const juz = data.juz.find((j) => cmp([s, a], j.start) >= 0 && cmp([s, a], j.end) <= 0);
  $('juz').textContent = juz ? `Juz ${juz.juz}` : '';
  document.body.classList.remove('idle-on');
}
const cmp = (x, y) => (x[0] - y[0]) || (x[1] - y[1]);

function status(kind, text) {
  const el = $('status');
  el.className = `pill ${kind}`;
  el.querySelector('b').textContent = text;
}

// ------------------------------------------------------------------ worker
worker.onmessage = ({ data: m }) => {
  if (m.type === 'ready') {
    asrReady = m.asr;
    if (params.has('demo')) return runDemo(params.get('demo'));
    const start = params.get('start') || store.get('start', null);
    if (start) setStart(start);
    listen(); // the mic meter works even without the model
    if (!asrReady) status('manual', 'Manual: no speech model');
  } else if (m.type === 'update') {
    if (m.ayah && m.changed) render(m.ayah.index);
    if (m.heard !== undefined && m.heard) $('heard').textContent = m.heard;
    if (asrReady || params.has('demo')) {
      if (m.state === 'LOCKED') status('following', 'Following');
      else status('listening', 'Listening');
    }
  } else if (m.type === 'error') {
    console.warn(m.message);
    status('error', m.message.length > 40 ? 'Problem: see settings' : m.message);
    $('heard').textContent = m.message;
  }
};
worker.postMessage({
  type: 'init',
  dataUrl: '/data/quran/quran.json',
  modelUrl: params.has('demo') ? null : MODEL + 'model.int8.onnx',
  tokensUrl: MODEL + 'tokens.txt',
});

async function listen() {
  if (capture) { capture.stop(); capture = null; }
  const wanted = store.get('input', '');
  try {
    capture = await openMic(wanted);
  } catch (e) {
    if (wanted) {
      // The saved input is gone (unplugged / renamed): fall back to the default.
      try { capture = await openMic(''); } catch (e2) { return micFailed(e2); }
    } else {
      return micFailed(e);
    }
  }
  $('mic').classList.remove('off');
  $('micName').textContent = capture.label;
  quietSince = performance.now();
  if (asrReady) status('listening', 'Listening');
  fillInputs();
}

function openMic(deviceId) {
  return startCapture({ deviceId, cleanup: store.get('cleanup', false) }, (chunk) => {
    showLevel(chunk);
    if (asrReady) worker.postMessage({ type: 'audio', samples: chunk }, [chunk.buffer]);
  });
}

function micFailed(e) {
  const msg = micError(e);
  $('mic').classList.add('off');
  $('micName').textContent = 'Microphone not working: press S';
  $('micHint').textContent = '';
  $('heard').textContent = msg;
  status('error', 'Microphone problem');
  openSettings();
}

// Live level meter (footer + settings). Warn if nothing is heard for a while.
let quietSince = performance.now();
let meterShown = 0;
function showLevel(chunk) {
  let peak = 0;
  for (let i = 0; i < chunk.length; i++) { const v = Math.abs(chunk[i]); if (v > peak) peak = v; }
  // log scale so quiet mics still move the bar: 0.001 -> 0%, 0.5 -> 100%
  const pct = Math.max(0, Math.min(100, ((Math.log10(Math.max(peak, 1e-4)) + 3) / 2.7) * 100));
  const now = performance.now();
  if (now - meterShown > 60) {
    meterShown = now;
    $('micLevel').style.width = pct + '%';
    $('micLevel2').style.width = pct + '%';
  }
  if (peak > 0.004) quietSince = now;
  $('micHint').textContent = now - quietSince > 6000 ? 'No sound from this mic' : '';
}

function setStart(ref) {
  const m = String(ref).match(/^(\d+):(\d+)$/);
  if (!m) return;
  const i = data.ayat.findIndex(([s, a]) => s === +m[1] && a === +m[2]);
  if (i < 0) return;
  worker.postMessage({ type: 'start', surah: +m[1], ayah: +m[2] });
  $('idleText').textContent = `Listening… tonight starts at ${data.surahs[+m[1] - 1].translit} ${m[1]}:${m[2]}`;
}

// ------------------------------------------------------------------ demo (no model)
async function runDemo(spec) {
  const [from, to] = spec.split('-');
  const [s1, a1] = from.split(':').map(Number);
  const [s2, a2] = (to || from).split(':').map(Number);
  const i1 = data.ayat.findIndex(([s, a]) => s === s1 && a === a1);
  const i2 = data.ayat.findIndex(([s, a]) => s === s2 && a === a2);
  status('listening', 'Demo');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1200);
  for (let i = i1; i <= i2; i++) {
    const words = ayahParts(i).text.split(' ');
    for (let w = 0; w < words.length; w += 3) {
      worker.postMessage({ type: 'text', text: words.slice(w, w + 3).join(' ') });
      await sleep(Number(params.get('pace') || 900));
    }
    await sleep(600);
  }
}

// ------------------------------------------------------------------ keys and settings
function toggle(id) { $(id).classList.toggle('on'); }

function openSettings() {
  $('settings').hidden = false;
  document.body.classList.add('settings-open');
  fillInputs();
}
function closeSettings() {
  $('settings').hidden = true;
  document.body.classList.remove('settings-open');
}

async function fillInputs() {
  const sel = $('input');
  try {
    const inputs = await listInputs();
    const opts = [new Option('System default', '')];
    for (const [k, d] of inputs.entries()) {
      if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
      opts.push(new Option(d.label || `Input ${k + 1}`, d.deviceId));
    }
    sel.replaceChildren(...opts);
    sel.value = store.get('input', '');
    if (sel.selectedIndex < 0) sel.value = '';
  } catch { /* no permission yet */ }
}
navigator.mediaDevices?.addEventListener?.('devicechange', fillInputs);

(function setupSettings() {
  const js = $('startJuz');
  js.append(new Option('Not set', ''));
  for (const j of data.juz) js.append(new Option(`Juz ${j.juz} (${j.start[0]}:${j.start[1]})`, `${j.start[0]}:${j.start[1]}`));
  $('cleanup').checked = store.get('cleanup', false);
  $('showTr').checked = store.get('showTr', true);
  document.body.classList.toggle('no-tr', !$('showTr').checked);
  // Switching the input takes effect straight away, so the meter shows it.
  $('input').onchange = () => { store.set('input', $('input').value); listen(); };
  $('cleanup').onchange = () => { store.set('cleanup', $('cleanup').checked); listen(); };
  $('apply').onclick = () => {
    store.set('input', $('input').value);
    store.set('cleanup', $('cleanup').checked);
    store.set('showTr', $('showTr').checked);
    document.body.classList.toggle('no-tr', !$('showTr').checked);
    const start = $('startRef').value.trim() || js.value;
    store.set('start', start || null);
    if (start) setStart(start);
    closeSettings();
    listen();
  };
  $('close').onclick = closeSettings;
})();

document.addEventListener('keydown', (e) => {
  if (!$('settings').hidden && e.key !== 'Escape') return;
  switch (e.key) {
    case 'ArrowRight': case 'PageDown': worker.postMessage({ type: 'next' }); break; // most clickers send these
    case 'ArrowLeft': case 'PageUp': worker.postMessage({ type: 'prev' }); break;
    case 'd': case 'D': toggle('dua'); break;
    case 'b': case 'B': case '.': toggle('blank'); break;
    case 's': case 'S': openSettings(); break;
    case 'Escape': closeSettings(); $('dua').classList.remove('on'); $('blank').classList.remove('on'); break;
    case 'f': case 'F': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); break;
  }
});

window.addEventListener('resize', () => shown >= 0 && fit());
// The Arabic font arrives after the first ayah may already be drawn: re-fit then.
document.fonts?.addEventListener?.('loadingdone', () => shown >= 0 && fit());
document.fonts?.ready.then(() => shown >= 0 && fit());
$('mic').addEventListener('click', openSettings);
// Show the mouse pointer only while it moves (it's a TV).
let cursorTimer = 0;
window.addEventListener('mousemove', () => {
  document.body.classList.add('cursor-on');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.remove('cursor-on'), 3000);
});
try { await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
document.body.classList.add('idle-on');
