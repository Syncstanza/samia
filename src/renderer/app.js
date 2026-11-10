// Display thread: draws the ayat and handles keys. The listening and matching
// happen in the worker (src/engine/worker.js) so drawing never stutters.
//
// URL options (handy for testing):
//   ?demo=2:255-2:257   play these ayat through the tracker without a model
//   ?start=2:142        set tonight's start point

import { startCapture, listInputs, micError } from './capture.js';
import { normalize } from '/src/engine/normalize.js';
import { TestRecorder } from './recorder.js';

const recorder = new TestRecorder();

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
  if (full) {
    // One span per word, each knowing where it ends (in matching letters),
    // so words light up as the imam reaches them.
    let end = 0;
    for (const word of p.text.split(' ')) {
      end += normalize(word).length;
      const w = document.createElement('span');
      w.className = 'w';
      w.dataset.end = end;
      w.textContent = word;
      ar.append(w, ' ');
    }
  } else {
    ar.textContent = p.text + ' ';
  }
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
  lit = -1;
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

// Light the words recited so far; the word being recited now glows.
// letter = how many letters of the ayah have been heard (from the tracker).
let lit = -1;
function light(letter) {
  if (letter === undefined || letter === null) return;
  const words = $('current').querySelectorAll('.w');
  // The tracker trails speech by a moment, so count a word as reached once
  // its first letters have been heard.
  let now = -1;
  for (let k = 0; k < words.length; k++) {
    const end = +words[k].dataset.end;
    const start = k ? +words[k - 1].dataset.end : 0;
    if (letter > start + Math.min(2, end - start - 1)) now = k;
  }
  if (now === lit) return;
  lit = now;
  for (let k = 0; k < words.length; k++) {
    words[k].classList.toggle('done', k < now);
    words[k].classList.toggle('now', k === now);
  }
}

// Ruku', sujood, etc.: a card over the (dimmed) Quran. Standing = no card.
let lastPos = '';
function showPosition(v) {
  $('rakah').textContent = `Rak'ah ${v.rakah}`;
  const on = v.position !== 'QIYAM' && store.get('showPos', true) && !muted;
  document.body.classList.toggle('pos-on', on);
  if (!on || v.position + v.note === lastPos) { if (!on) lastPos = ''; return; }
  lastPos = v.position + v.note;
  $('posAr').textContent = v.ar;
  $('posEn').textContent = v.en;
  $('posNote').textContent = v.note;
  const el = $('position');
  el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
}

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
    if (store.get('istirahah', false)) worker.postMessage({ type: 'salah', istirahah: true });
    const start = params.get('start') || store.get('start', null);
    if (start) setStart(start);
    listen(); // the mic meter works even without the model
    if (!asrReady) status('manual', 'Manual: no speech model');
  } else if (m.type === 'update') {
    recorder.addUpdate(m);
    if (m.ayah && m.changed) render(m.ayah.index).then(() => light(m.letter));
    else if (m.ayah && m.ayah.index === shown) light(m.letter);
    if (m.heard !== undefined && m.heard) $('heard').textContent = m.heard;
    if (m.salah) showPosition(m.salah);
    if ((asrReady || params.has('demo')) && !muted) {
      if (m.phase === 'MOVEMENT') status('following', "Ruku' & Sujood");
      else if (m.state === 'LOCKED') status('following', 'Following');
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
  takbirUrl: '/data/takbir-ayat.json',
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
    if (muted) return;
    showLevel(chunk);
    recorder.addAudio(chunk);
    if (asrReady) worker.postMessage({ type: 'audio', samples: chunk }, [chunk.buffer]);
  });
}

// Mute: stop following (e.g. for a talk or announcements). The screen holds.
let muted = false;
function setMuted(on) {
  muted = on;
  document.body.classList.toggle('muted', on);
  $('btnMute').setAttribute('aria-pressed', on);
  $('btnMute').title = on ? 'Unmute (M)' : 'Mute (M)';
  $('micLevel').style.width = '0%';
  if (on) status('manual', 'Muted');
  else if (asrReady) status('listening', 'Listening');
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
  const silent = now - quietSince > 6000;
  $('micHint').textContent = silent ? 'No sound from this mic' : '';
  $('mic').classList.toggle('warn', silent);
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
  // ?demo=...&rakah: then go through ruku' and the sujood as the imam would.
  if (params.has('rakah')) {
    const pace = Number(params.get('pace') || 900);
    const say = async (text, silent) => {
      // The imam pauses, then draws the takbir out.
      worker.postMessage({ type: 'text', text, utter: { dur: 1.6, gapBefore: 0.8 } });
      for (let k = 0; k < silent; k++) { await sleep(pace); worker.postMessage({ type: 'text', text: '' }); }
      await sleep(pace);
    };
    for (let k = 0; k < 2; k++) { await sleep(pace); worker.postMessage({ type: 'text', text: '' }); }
    await say('الله اكبر', 4);
    await say('سمع الله لمن حمده', 3);
    await say('الله اكبر', 4);
    await say('الله اكبر', 3);
    await say('الله اكبر', 4);
    await say('الله اكبر', 4);
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
  $('showPos').checked = store.get('showPos', true);
  $('istirahah').checked = store.get('istirahah', false);
  document.body.classList.toggle('no-tr', !$('showTr').checked);
  // Switching the input takes effect straight away, so the meter shows it.
  $('input').onchange = () => { store.set('input', $('input').value); listen(); };
  $('cleanup').onchange = () => { store.set('cleanup', $('cleanup').checked); listen(); };
  $('apply').onclick = () => {
    store.set('input', $('input').value);
    store.set('cleanup', $('cleanup').checked);
    store.set('showTr', $('showTr').checked);
    store.set('showPos', $('showPos').checked);
    if (store.get('istirahah', false) !== $('istirahah').checked) {
      store.set('istirahah', $('istirahah').checked);
      worker.postMessage({ type: 'salah', istirahah: $('istirahah').checked });
    }
    document.body.classList.toggle('no-tr', !$('showTr').checked);
    const start = $('startRef').value.trim() || js.value;
    store.set('start', start || null);
    if (start) setStart(start);
    closeSettings();
    listen();
  };
  $('close').onclick = closeSettings;
  $('saveTest').onclick = () => { recorder.save(); $('saveTest').textContent = 'Saved to your Downloads folder'; setTimeout(() => { $('saveTest').textContent = 'Save test recording (last 2 min)'; }, 4000); };
})();

document.addEventListener('keydown', (e) => {
  if (!$('settings').hidden && e.key !== 'Escape') return;
  switch (e.key) {
    case 'ArrowRight': case 'PageDown': worker.postMessage({ type: 'next' }); break; // most clickers send these
    case 'ArrowLeft': case 'PageUp': worker.postMessage({ type: 'prev' }); break;
    case 'm': case 'M': setMuted(!muted); break;
    case 'S': if (e.ctrlKey && e.shiftKey) { recorder.save(); break; } openSettings(); break;
    case 'd': case 'D': toggle('dua'); break;
    case 'b': case 'B': case '.': toggle('blank'); break;
    case 's': openSettings(); break;
    case 'Escape': closeSettings(); $('dua').classList.remove('on'); $('blank').classList.remove('on'); break;
    case 'f': case 'F': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); break;
  }
});

window.addEventListener('resize', () => shown >= 0 && fit());
// The Arabic font arrives after the first ayah may already be drawn: re-fit then.
document.fonts?.addEventListener?.('loadingdone', () => shown >= 0 && fit());
document.fonts?.ready.then(() => shown >= 0 && fit());
$('mic').addEventListener('click', openSettings);
// Controls and the pointer show only while the mouse moves (it's a TV).
let cursorTimer = 0;
function wake() {
  document.body.classList.add('cursor-on');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => {
    if (!$('controls').matches(':hover')) document.body.classList.remove('cursor-on');
    else wake();
  }, 3000);
}
window.addEventListener('mousemove', wake);
window.addEventListener('touchstart', wake);

const send = (type) => () => worker.postMessage({ type });
$('btnPrev').onclick = send('prev');
$('btnNext').onclick = send('next');
$('btnMute').onclick = () => setMuted(!muted);
$('btnDua').onclick = () => toggle('dua');
$('btnBlank').onclick = () => toggle('blank');
$('btnSettings').onclick = openSettings;
$('btnFull').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
// Clicking an overlay (dua / blank) closes it.
for (const id of ['dua', 'blank']) $(id).addEventListener('click', () => $(id).classList.remove('on'));
try { await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
document.body.classList.add('idle-on');
