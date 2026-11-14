// Display thread: screens, drawing and keys. Listening, following and scoring
// happen in the worker (src/engine/worker.js) so drawing never stutters.
//
// Screens (body.screen-*): home -> free | setup -> ready -> turn -> checking -> result -> ... -> board
//
// URL options (handy for testing):
//   ?demo=78:1-78:5   free recite: play these ayat through the tracker without a model
//   ?start=2:142      free recite: start following from here

import { startCapture, listInputs, micError } from './capture.js';
import { normalize } from '/src/engine/normalize.js';
import { TestRecorder } from './recorder.js';
import { initNews } from './news.js';
import { heardOpening } from '/src/engine/opening.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const MODEL = '/models/quran-asr-tiny/';
const recorder = new TestRecorder();

// Settings: in the app they're kept in a file (window.api); in a plain browser
// in the page's own storage.
const saved = window.api ? window.api.settings() : null;
const store = {
  get(k, d) {
    if (saved) return k in saved ? saved[k] : d;
    try { const v = localStorage.getItem('samia.' + k); return v === null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    if (saved) { saved[k] = v; window.api.setSetting(k, v); return; }
    try { localStorage.setItem('samia.' + k, JSON.stringify(v)); } catch { /* storage off */ }
  },
};

const data = await fetch('/data/quran/quran.json').then((r) => r.json());
const worker = new Worker('/src/engine/worker.js', { type: 'module' });
let shown = -1;
let asrReady = false;
let capture = null;
let screenName = 'home';
let session = null; // turns: {mode: 'judged'|'friends'|'hifz', free, from, to, hide, reciters: [{name, result}], i}
// free: hifz from anywhere (no passage chosen; from/to come with each result)
const scored = () => session && session.mode !== 'judged';

// ------------------------------------------------------------------ screens
const SCREENS = ['home', 'free', 'setup', 'ready', 'turn', 'checking', 'result', 'board', 'judgedDone'];
function screen(name) {
  screenName = name;
  for (const s of SCREENS) document.body.classList.toggle('screen-' + s, s === name);
  $('setup').hidden = name !== 'setup';
  $('ready').hidden = name !== 'ready';
  $('checking').hidden = name !== 'checking';
  $('result').hidden = name !== 'result';
  $('scoreboard').hidden = name !== 'board';
  $('judgedDone').hidden = name !== 'judgedDone';
  $('turnBar').hidden = name !== 'turn';
  if (name !== 'turn' && name !== 'free' && document.body.classList.contains('gate-on')) openGate(false);
  if (name !== 'free' && bookOn) setBook(false);
  document.body.classList.toggle('hide-text', name === 'turn' && !!session?.hide);
  $('turnInfo').textContent = name === 'turn' && session ? session.reciters[session.i].name : '';
}
const following = () => screenName === 'free' || screenName === 'turn';

// ------------------------------------------------------------------ drawing
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
const cmp = (x, y) => (x[0] - y[0]) || (x[1] - y[1]);
const surahLabel = (s) => `${data.surahs[s - 1].translit}`;
const refLabel = (from, to) => {
  const [s1, a1] = data.ayat[from], [, a2] = data.ayat[to];
  return `${surahLabel(s1)} ${s1}:${a1}${to > from ? '–' + a2 : ''} · ${to - from + 1} ayat`;
};

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
  // In a turn, only the passage is shown.
  if (screenName === 'turn' && session && !session.free && (index < session.from || index > session.to)) return;
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
    // so words light up as the reciter reaches them.
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
  let lo = Math.max(2.6 * vh, 22), hi = Math.max(8.5 * vh, 44); // the floors only matter on a phone
  for (let k = 0; k < 9; k++) {
    const mid = (lo + hi) / 2;
    box.style.setProperty('--ar-size', `${mid}px`);
    box.style.setProperty('--tr-size', `${Math.max(1.5 * vh, 13, Math.min(3.2 * vh, mid * 0.4))}px`);
    if (box.scrollHeight <= box.clientHeight + 1) lo = mid; else hi = mid;
  }
  box.style.setProperty('--ar-size', `${lo}px`);
  box.style.setProperty('--tr-size', `${Math.max(1.5 * vh, 13, Math.min(3.2 * vh, lo * 0.4))}px`);
}

async function render(index, force = false) {
  if ((index === shown && !force) || index < 0) return;
  const dir = shown < 0 || force ? 'fade-in' : index > shown ? 'enter-fwd' : 'enter-back';
  shown = index;
  try { await document.fonts.load('40px "Amiri Quran"', 'بسم'); } catch { /* fit again later */ }
  if (index !== shown) return; // a newer ayah arrived meanwhile
  fill($('prev'), index - 1, { full: false });
  fill($('current'), index, { full: true });
  lit = -1;
  fill($('next'), index + 1, { full: false });
  fit();
  if (bookOn) renderBook(index);
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

// Light the words recited so far; the word being recited now glows.
// letter = how many letters of the ayah have been heard (from the tracker).
let lit = -1;
function light(letter) {
  if (letter === undefined || letter === null) return;
  if (bookOn) lightBook(letter);
  const words = $('current').querySelectorAll('.w');
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

// ------------------------------------------------------------------ book (page) view
// The page of the Madinah mushaf the reciter is on, line for line (15 lines), recited words lit,
// the word being recited glowing, the page turning by itself.
// Layout: quran.ws/text (CC BY 4.0); text and font: King Fahd Complex.
var bookOn = false, bookPage = -1; // var: screen() reads it before this point runs
let madani = null, madaniLoading = null;
function loadMadani() {
  if (!madaniLoading) {
    madaniLoading = (async () => {
      const [m, face] = await Promise.all([
        fetch('/data/quran/madani.json').then((r) => r.json()),
        new FontFace('KFGQPC Hafs', "url('/data/quran/UthmanicHafs-v-3.0.ttf')").load(),
      ]);
      document.fonts.add(face);
      madani = m;
      return m;
    })().catch((e) => { madaniLoading = null; console.warn('page view: ' + e.message); });
  }
  return madaniLoading;
}
const bisect = (arr, x) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid] <= x) lo = mid; else hi = mid - 1; } return lo; };
const pageOf = (index) => bisect(madani.pages, madani.ayahStart[index]);
const endsCache = new Map();
// Where each word of an ayah ends, in the letters the speech engine matches (the two texts split a few words differently, so scaled).
function ayahEnds(a) {
  let e = endsCache.get(a);
  if (e) return e;
  const from = madani.ayahStart[a], to = a + 1 < madani.ayahStart.length ? madani.ayahStart[a + 1] : madani.words.length;
  const lens = [];
  let sum = 0;
  for (let w = from; w < to; w++) { sum += normalize(madani.words[w]).length; lens.push(sum); }
  const total = normalize(ayahParts(a).text).length;
  e = lens.map((x) => Math.round(x * total / (sum || 1)));
  endsCache.set(a, e);
  return e;
}
function buildPage(page) {
  const M = madani;
  const from = M.pages[page], to = page + 1 < M.pages.length ? M.pages[page + 1] : M.words.length;
  const first = bisect(M.lines, from), last = to >= M.words.length ? M.lines.length - 1 : bisect(M.lines, to - 1);
  const box = $('bookText');
  box.replaceChildren();
  let slots = 0, a = bisect(M.ayahStart, from);
  for (let li = first; li <= last; li++) {
    const wFrom = M.lines[li], wTo = li + 1 < M.lines.length ? M.lines[li + 1] : M.words.length;
    const sIdx = M.surahStart.indexOf(wFrom);
    if (sIdx >= 0) {
      const h = document.createElement('div');
      h.className = 'bk-head';
      h.textContent = data.surahs[sIdx].name;
      box.append(h); slots++;
      if (M.bsm[sIdx] && sIdx !== 0) { const b = document.createElement('div'); b.className = 'bk-bsm'; b.textContent = data.bismillah; box.append(b); slots++; }
    }
    const line = document.createElement('div');
    line.className = 'bk-line';
    for (let w = wFrom; w < wTo; w++) {
      while (a + 1 < M.ayahStart.length && M.ayahStart[a + 1] <= w) a++;
      const el = document.createElement('span');
      el.className = 'w';
      el.dataset.a = a;
      el.dataset.end = ayahEnds(a)[w - M.ayahStart[a]];
      el.textContent = M.words[w];
      line.append(el);
      if (w + 1 === (a + 1 < M.ayahStart.length ? M.ayahStart[a + 1] : M.words.length)) {
        const num = document.createElement('span');
        num.className = 'num';
        num.dataset.a = a;
        num.textContent = '\u06DD' + arNum(data.ayat[a][1]);
        line.append(num);
      }
    }
    box.append(line); slots++;
  }
  box.dataset.slots = slots;
  $('bookNo').textContent = arNum(page + 1);
  bookPage = page;
  fitBook();
  requestAnimationFrame(() => { if (bookOn) fitBook(); }); // again once the page has real sizes and fonts
  document.fonts.ready.then(() => { if (bookOn) fitBook(); });
}
// Largest type for which every line fits the page width; lines are spread to full width like the printed page.
function fitBook() {
  const area = $('bookPage'), text = $('bookText');
  const slots = +text.dataset.slots || 15;
  const cs = getComputedStyle(area);
  const inner = area.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const rowH = (inner - $('bookNo').offsetHeight - 2) / 15;
  text.style.height = `${rowH * slots}px`;
  text.style.setProperty('--row', `${rowH}px`);
  const lines = [...text.querySelectorAll('.bk-line')];
  for (const l of lines) l.classList.remove('short');
  let lo = 10, hi = Math.max(10, rowH * 0.75);
  const fits = () => lines.every((l) => l.scrollWidth <= l.clientWidth + 1);
  for (let k = 0; k < 10; k++) {
    const mid = (lo + hi) / 2;
    text.style.fontSize = `${mid}px`;
    if (fits()) lo = mid; else hi = mid;
  }
  text.style.fontSize = `${lo}px`;
  // A line that is much shorter than the page (end of a surah) is centred, not stretched.
  for (const l of lines) {
    l.classList.add('measure');
    const items = [...l.children];
    const natural = items.reduce((t, c) => t + c.getBoundingClientRect().width, 0) + (items.length - 1) * lo * 0.25;
    l.classList.remove('measure');
    if (natural < l.clientWidth * 0.8) l.classList.add('short');
  }
}
async function renderBook(index) {
  if (!madani) { await loadMadani(); if (!madani) return; }
  if (!bookOn || index !== shown) return;
  const page = pageOf(index);
  if (page !== bookPage) buildPage(page);
  // Everything before the current ayah is recited; what comes after is not yet.
  for (const w of $('bookText').querySelectorAll('.w, .num')) {
    const a = +w.dataset.a;
    w.classList.toggle('past', a < index);
    w.classList.remove('now', 'done');
  }
  $('bookTr').textContent = data.ayat[index][3];
}
function lightBook(letter) {
  if (!madani) return;
  const words = $('bookText').querySelectorAll(`.w[data-a="${shown}"]`);
  let now = -1;
  for (let k = 0; k < words.length; k++) {
    const end = +words[k].dataset.end;
    const start = k ? +words[k - 1].dataset.end : 0;
    if (letter > start + Math.min(2, end - start - 1)) now = k;
  }
  for (let k = 0; k < words.length; k++) {
    words[k].classList.toggle('done', k < now);
    words[k].classList.toggle('now', k === now);
  }
}
function setBook(on) {
  bookOn = on && screenName === 'free';
  document.body.classList.toggle('book-on', bookOn);
  $('btnBook').setAttribute('aria-pressed', String(bookOn));
  try { localStorage.setItem('samia.book', bookOn ? '1' : ''); } catch { /* not saved */ }
  if (bookOn) { bookPage = -1; if (shown >= 0) { renderBook(shown); } }
  else fit();
}
$('btnBook').onclick = () => setBook(!bookOn);
window.addEventListener('resize', () => { if (bookOn && bookPage >= 0) fitBook(); });

function status(kind, text) {
  const el = $('status');
  el.className = `pill ${kind}`;
  el.querySelector('b').textContent = text;
}

// ------------------------------------------------------------------ worker
worker.onmessage = ({ data: m }) => {
  if (m.type === 'ready') {
    asrReady = m.asr;
    window.dispatchEvent(new CustomEvent('samia-ready', { detail: { asr: m.asr } })); // the Android build test waits for this
    if (params.has('demo')) { startFree(); return runDemo(params.get('demo')); }
    if (params.get('start')) { startFree(); setStart(params.get('start')); }
    listen(); // the mic meter works even without the model
    if (!asrReady) status('manual', 'No speech model');
  } else if (m.type === 'update') {
    if (m.ms) { speedAvg = speedAvg ? 0.8 * speedAvg + 0.2 * m.ms : m.ms; $('speed').textContent = `Listening speed: ${Math.round(speedAvg)} ms per check (under about 450 is smooth)`; }
    recorder.addUpdate(m);
    if ((screenName === 'free' || (screenName === 'turn' && session?.free)) && shown < 0) $('idleHeard').textContent = m.heard ? m.heard.split(' ').slice(-6).join(' ') : $('idleHeard').textContent;
    if (m.heard && gatePending && (screenName === 'turn' || screenName === 'free')) {
      gateHeard = (gateHeard + ' ' + m.heard).slice(-400);
      const o = heardOpening(gateHeard);
      if (screenName === 'free') {
        // Free recite waits for the whole opening (Bismillah is its last words), then a beat for the last word to finish.
        if (o.basmala && !gateDone) gateDone = setTimeout(passGate, 800);
      } else if (o.taawwudh || o.basmala) passGate();
    }
    if (m.heard) { $('heard').textContent = m.heard; lastSpeechAt = performance.now(); if (screenName === 'turn' && !gatePending) spokeInTurn = true; }
    if (!following()) return;
    // In a turn the screen never leaves the passage (it would go blank).
    if (screenName === 'turn' && !session.free && m.ayah && (m.ayah.index < session.from || m.ayah.index > session.to)) return;
    if (m.ayah && m.changed) render(m.ayah.index).then(() => light(m.letter));
    else if (m.ayah && m.ayah.index === shown) light(m.letter);
    if (screenName === 'turn') watchForEnd(m);
    if ((asrReady || params.has('demo')) && !muted) {
      if (m.state === 'LOCKED' && shown >= 0) status('following', 'Following');
      else status('listening', 'Listening');
    }
  } else if (m.type === 'scoring') {
    $('checkBar').style.width = Math.round(m.progress * 100) + '%';
  } else if (m.type === 'score') {
    showResult(m.result);
  } else if (m.type === 'error') {
    console.warn(m.message);
    console.log('SAMIA_ERROR ' + m.message);
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

// ------------------------------------------------------------------ free recite
function startFree() {
  session = null;
  screen('free');
  shown = -1;
  for (const id of ['prev', 'current', 'next']) $(id).replaceChildren();
  $('surahAr').textContent = ''; $('surahEn').textContent = ''; $('juz').textContent = '';
  $('idleText').textContent = 'Start reciting… Sami\'a will find where you are.';
  $('idleHeard').textContent = '';
  document.body.classList.add('idle-on');
  worker.postMessage({ type: 'reset' });
  try { if (localStorage.getItem('samia.book')) setBook(true); } catch { /* default off */ }
  openGate(true); // a'udhu billah / Bismillah first: proves the mic works and gets the listener warmed up
}

function setStart(ref) {
  const m = String(ref).match(/^(\d+):(\d+)$/);
  if (!m) return;
  if (!data.ayat.some(([s, a]) => s === +m[1] && a === +m[2])) return;
  worker.postMessage({ type: 'start', surah: +m[1], ayah: +m[2] });
}

// ------------------------------------------------------------------ competition / hifz setup
function openSetup(mode) {
  const last = store.get('session', {});
  $('setupTitle').textContent = { hifz: 'Hifz test', judged: 'School / Masjid competition', friends: 'Friends competition' }[mode];
  const sel = $('pickSurah');
  if (!sel.options.length) {
    for (const s of data.surahs) sel.append(new Option(`${s.n}. ${s.translit} — ${s.name} (${s.ayahs} ayat)`, s.n));
    sel.onchange = () => { $('pickFrom').value = 1; $('pickTo').value = Math.min(10, data.surahs[sel.value - 1].ayahs); passageInfo(); };
    $('pickFrom').oninput = passageInfo;
    $('pickTo').oninput = passageInfo;
    $('pickWhole').onclick = () => { $('pickFrom').value = 1; $('pickTo').value = data.surahs[sel.value - 1].ayahs; passageInfo(); };
  }
  sel.value = last.surah || 78;
  $('pickFrom').value = last.fromAyah || 1;
  $('pickTo').value = last.toAyah || Math.min(10, data.surahs[sel.value - 1].ayahs);
  const names = last[namesKey(mode)] || (mode === 'hifz' ? ['Reciter 1'] : ['Reciter 1', 'Reciter 2']);
  $('reciters').replaceChildren();
  names.forEach(addReciterRow);
  $('hideText').checked = mode === 'hifz';
  setupMode = mode;
  $('pickWhere').hidden = mode !== 'hifz';
  setWhere(mode === 'hifz' && !!last.hifzAnywhere);
  passageInfo();
  screen('setup');
}
let anywhere = false;
function setWhere(free) {
  anywhere = free;
  $('wherePassage').classList.toggle('on', !free);
  $('whereAnywhere').classList.toggle('on', free);
  $('anywhereInfo').hidden = !free;
  for (const id of ['pickSurahRow', 'pickRangeRow', 'pickInfo']) $(id).hidden = free;
}
$('wherePassage').onclick = () => setWhere(false);
$('whereAnywhere').onclick = () => setWhere(true);
let setupMode = 'friends';
const namesKey = (mode) => ({ hifz: 'hifzNames', judged: 'judgedNames' }[mode] || 'names');

function addReciterRow(name = '') {
  const row = document.createElement('div');
  row.className = 'reciter-row';
  const input = document.createElement('input');
  input.value = name;
  input.placeholder = `Reciter ${$('reciters').children.length + 1}`;
  const del = document.createElement('button');
  del.className = 'ghost';
  del.textContent = '✕';
  del.title = 'Remove';
  del.onclick = () => { if ($('reciters').children.length > 1) row.remove(); };
  row.append(input, del);
  $('reciters').append(row);
  return input;
}

function readPassage() {
  const s = +$('pickSurah').value;
  const n = data.surahs[s - 1].ayahs;
  let a1 = Math.max(1, Math.min(n, Math.round(+$('pickFrom').value || 1)));
  let a2 = Math.max(1, Math.min(n, Math.round(+$('pickTo').value || a1)));
  if (a2 < a1) [a1, a2] = [a2, a1];
  const from = data.ayat.findIndex(([x, y]) => x === s && y === a1);
  return { s, a1, a2, from, to: from + (a2 - a1) };
}
function passageInfo() {
  const p = readPassage();
  const words = data.ayat.slice(p.from, p.to + 1).reduce((n, x) => n + x[2].split(' ').length, 0);
  $('pickInfo').textContent = `${refLabel(p.from, p.to)} · about ${words} words`;
}

$('addReciter').onclick = () => addReciterRow().focus();
$('setupCancel').onclick = goHome;
$('setupStart').onclick = () => {
  const p = readPassage();
  const names = [...$('reciters').querySelectorAll('input')].map((i, k) => i.value.trim() || `Reciter ${k + 1}`);
  const last = store.get('session', {});
  const free = setupMode === 'hifz' && anywhere;
  store.set('session', { ...last, surah: p.s, fromAyah: p.a1, toAyah: p.a2, [namesKey(setupMode)]: names, ...(setupMode === 'hifz' ? { hifzAnywhere: free } : {}) });
  session = { mode: setupMode, free, from: free ? null : p.from, to: free ? null : p.to, hide: $('hideText').checked, reciters: names.map((name) => ({ name })), i: 0 };
  showReady();
};

// ------------------------------------------------------------------ turns
function showReady() {
  const r = session.reciters[session.i];
  $('readyCount').textContent = session.reciters.length > 1 ? `Reciter ${session.i + 1} of ${session.reciters.length}` : ({ hifz: 'Hifz test', judged: 'Competition' }[session.mode] || 'Recitation');
  $('readyName').textContent = r.name;
  $('readyPassage').textContent = (session.free ? 'From anywhere you like' : refLabel(session.from, session.to)) + (session.hide ? ' · text hidden' : '');
  $('readyEnds').textContent = session.free ? '(it also ends by itself after 8 seconds of silence)' : '(it also ends by itself after the last word)';
  screen('ready');
  $('readyGo').focus();
}

let turnStarted = 0, clockTimer = 0, lastSpeechAt = 0, reachedEnd = false, spokeInTurn = false;
// Every turn starts with a'udhu billah / Bismillah: hearing it proves the mic works. Until then the turn hasn't begun.
let gatePending = false, gateHeard = '', gateDone = 0;
let speedAvg = 0;
function openGate(on) {
  if (on && !$('gateVerseAr').textContent) {
    const v = data.ayat.find(([s, a]) => s === 73 && a === 4); // وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا
    if (v) { $('gateVerseAr').textContent = v[2]; $('gateVerseEn').textContent = v[3]; }
  }
  gatePending = on;
  gateHeard = '';
  clearTimeout(gateDone); gateDone = 0;
  document.body.classList.toggle('gate-on', on);
  $('openGate').hidden = !on;
}
function passGate() {
  if (!gatePending) return;
  openGate(false);
  if (screenName === 'free') {
    // Free recite has no clock or turn. Start fresh: whatever matched while the opening was being said is not the recitation.
    shown = -1;
    for (const id of ['prev', 'current', 'next']) $(id).replaceChildren();
    $('surahAr').textContent = ''; $('surahEn').textContent = ''; $('juz').textContent = '';
    $('idleHeard').textContent = '';
    document.body.classList.add('idle-on');
    worker.postMessage({ type: 'reset' });
    return;
  }
  turnStarted = performance.now(); // the clock starts when the reciting does
  lastSpeechAt = performance.now();
  spokeInTurn = false;
  reachedEnd = false;
  $('turnClock').textContent = '0:00';
}
$('gateSkip').onclick = passGate;
function beginTurn() {
  screen('turn');
  shown = -1;
  reachedEnd = false;
  spokeInTurn = false;
  lastSpeechAt = performance.now();
  if (session.free) {
    // From anywhere: nothing on screen until Sami'a finds the place.
    for (const id of ['prev', 'current', 'next']) $(id).replaceChildren();
    $('surahAr').textContent = ''; $('surahEn').textContent = ''; $('juz').textContent = '';
    $('idleText').textContent = 'Start reciting from anywhere… the words appear as you say them.';
    $('idleHeard').textContent = '';
    document.body.classList.add('idle-on');
    worker.postMessage({ type: 'turnStart', free: true });
  } else {
    render(session.from, true);
    worker.postMessage({ type: 'turnStart', from: session.from, to: session.to });
  }
  turnStarted = performance.now();
  openGate(true);
  clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    if (gatePending) return;
    const s = Math.floor((performance.now() - turnStarted) / 1000);
    $('turnClock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    // Ends by itself: last word reached, then 2.5 s of silence. From anywhere
    // there is no last word: 8 s of silence once something was followed.
    if (reachedEnd && performance.now() - lastSpeechAt > 2500) endTurn();
    if (session.free && shown >= 0 && spokeInTurn && performance.now() - lastSpeechAt > 8000) endTurn();
  }, 250);
  status('listening', 'Listening');
}

function watchForEnd(m) {
  if (session.free) return;
  // Only what was recited in THIS turn counts (a late result from the previous
  // turn could still arrive just after it starts).
  if (!spokeInTurn || performance.now() - turnStarted < 1000) return;
  if (!m.ayah || m.ayah.index !== session.to) return;
  const len = normalize(ayahParts(session.to).text).length;
  if (m.letter >= len - 2) reachedEnd = true;
}

function endTurn() {
  if (screenName !== 'turn') return;
  if (gatePending) openGate(false);
  clearInterval(clockTimer);
  session.reciters[session.i].seconds = Math.round((performance.now() - turnStarted) / 1000);
  if (!scored()) {
    // Judged: the judges score. Straight on to the next reciter.
    worker.postMessage({ type: 'turnEnd', score: false });
    if (session.i < session.reciters.length - 1) { session.i++; showReady(); return; }
    $('judgedCount').textContent = `${refLabel(session.from, session.to)} · ${session.reciters.length} reciter${session.reciters.length > 1 ? 's' : ''}`;
    screen('judgedDone');
    $('judgedAgain').focus();
    return;
  }
  $('checkBar').style.width = '0%';
  screen('checking');
  worker.postMessage({ type: 'turnEnd' });
}

function showResult(r) {
  if (!scored() || screenName !== 'checking') return;
  const who = session.reciters[session.i];
  const time = `${Math.floor(who.seconds / 60)}:${String(who.seconds % 60).padStart(2, '0')}`;
  if (r.none) {
    // From anywhere, and nothing was found to score.
    who.result = null;
    $('resultWho').textContent = `${who.name} · ${time}`;
    $('resultScore').textContent = '–';
    for (const id of ['cntCorrect', 'cntMistake', 'cntSkipped', 'cntUnread']) $(id).textContent = 0;
    const p = document.createElement('p');
    p.className = 'ayah-line none';
    p.textContent = "Sami'a couldn't find where you were reciting. Try again, a little closer to the microphone.";
    $('review').replaceChildren(p);
    $('resultNext').textContent = session.i === session.reciters.length - 1 ? (session.reciters.length > 1 ? 'See the scoreboard' : 'Done') : `Next: ${session.reciters[session.i + 1].name}`;
    screen('result');
    return;
  }
  who.result = r;
  $('resultWho').textContent = `${who.name} · ${refLabel(r.from, r.to)} · ${time}`;
  $('resultScore').textContent = Math.round(r.score);
  const count = (m) => r.marks.filter((x) => x === m).length;
  $('cntCorrect').textContent = count('correct');
  $('cntMistake').textContent = count('mistake');
  $('cntSkipped').textContent = count('skipped');
  $('cntUnread').textContent = count('unread');

  // The passage with every word marked.
  const review = $('review');
  review.replaceChildren();
  let line = null, lineAyah = -1;
  r.words.forEach((w, k) => {
    if (w.ayah !== lineAyah) {
      if (line) review.append(line);
      line = document.createElement('p');
      line.className = 'ayah-line';
      lineAyah = w.ayah;
    }
    const span = document.createElement('span');
    span.className = `w ${r.marks[k]}`;
    span.textContent = w.text;
    line.append(span, ' ');
    const next = r.words[k + 1];
    if (!next || next.ayah !== w.ayah) {
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = '۝' + arNum(data.ayat[w.ayah][1]);
      line.append(num);
    }
  });
  if (line) review.append(line);

  const last = session.i === session.reciters.length - 1;
  $('resultNext').textContent = last ? (session.reciters.length > 1 ? 'See the scoreboard' : 'Done') : `Next: ${session.reciters[session.i + 1].name}`;
  screen('result');
}

$('readyGo').onclick = beginTurn;
$('turnDone').onclick = endTurn;
$('resultRetry').onclick = () => showReady();
$('resultNext').onclick = () => {
  if (session.i < session.reciters.length - 1) { session.i++; showReady(); return; }
  if (session.reciters.length > 1) showBoard(); else openSetup(session.mode);
};

function showBoard() {
  const ranked = session.reciters.filter((r) => r.result)
    .sort((a, b) => b.result.score - a.result.score || a.seconds - b.seconds);
  const medals = ['🥇', '🥈', '🥉'];
  $('boardPassage').textContent = (session.free ? 'From anywhere' : refLabel(session.from, session.to)) + (session.hide ? ' · from memory' : '');
  $('board').replaceChildren(...ranked.map((r, k) => {
    const li = document.createElement('li');
    const t = `${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}`;
    li.innerHTML = `<span class="place"></span><span class="who"></span><span class="sub"></span><span class="pts"></span>`;
    li.querySelector('.place').textContent = medals[k] || k + 1;
    li.querySelector('.who').textContent = r.name;
    li.querySelector('.sub').textContent = `${session.free ? refLabel(r.result.from, r.result.to) + ' · ' : ''}${r.result.correct}/${r.result.total} words · ${t}`;
    li.querySelector('.pts').textContent = `${Math.round(r.result.score)}%`;
    return li;
  }));
  screen('board');
}
$('boardAgain').onclick = () => openSetup(session.mode);
$('boardHome').onclick = goHome;
$('judgedAgain').onclick = () => openSetup('judged');
$('judgedHome').onclick = goHome;

function goHome() {
  if (gatePending) openGate(false);
  if (screenName === 'turn') { clearInterval(clockTimer); worker.postMessage({ type: 'turnEnd', score: false }); }
  session = null;
  showModes('main');
  screen('home');
}
function showModes(which) {
  $('modesMain').hidden = which !== 'main';
  $('modesCompetition').hidden = which !== 'competition';
  $('modesBack').hidden = which === 'main';
  document.querySelector(`#modes${which === 'main' ? 'Main' : 'Competition'} .mode`).focus();
}
for (const b of document.querySelectorAll('.mode')) {
  b.onclick = () => {
    const m = b.dataset.mode;
    if (m === 'free') startFree();
    else if (m === 'competition') showModes('competition');
    else openSetup(m);
  };
}
$('modesBack').onclick = () => showModes('main');

// ------------------------------------------------------------------ microphone
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

// ------------------------------------------------------------------ settings
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
  $('cleanup').checked = store.get('cleanup', false);
  $('showTr').checked = store.get('showTr', true);
  document.body.classList.toggle('no-tr', !$('showTr').checked);
  // Switching the input takes effect straight away, so the meter shows it.
  $('input').onchange = () => { store.set('input', $('input').value); listen(); };
  $('cleanup').onchange = () => { store.set('cleanup', $('cleanup').checked); listen(); };
  $('showTr').onchange = () => { store.set('showTr', $('showTr').checked); document.body.classList.toggle('no-tr', !$('showTr').checked); };
  $('apply').onclick = closeSettings;
  $('saveTest').onclick = () => { recorder.save(); $('saveTest').textContent = 'Saved to your Downloads folder'; setTimeout(() => { $('saveTest').textContent = 'Save test recording (last 2 min)'; }, 4000); };
})();

// ------------------------------------------------------------------ keys and controls
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select') && e.key !== 'Escape') return;
  if (!$('settings').hidden && e.key !== 'Escape') return;
  if (!$('news').hidden) return; // the What's new / announcements dialog handles its own keys
  switch (e.key) {
    case ' ': if (screenName === 'ready') { e.preventDefault(); beginTurn(); } break;
    case 'Enter': if (screenName === 'turn') endTurn(); break;
    case 'ArrowRight': case 'PageDown': if (following()) worker.postMessage({ type: 'next' }); break; // most clickers send these
    case 'ArrowLeft': case 'PageUp': if (following()) worker.postMessage({ type: 'prev' }); break;
    case 'm': case 'M': setMuted(!muted); break;
    case 'h': case 'H': goHome(); break;
    case 'S': if (e.ctrlKey && e.shiftKey) { recorder.save(); break; } openSettings(); break;
    case 's': openSettings(); break;
    case 'b': case 'B': case '.': $('blank').classList.toggle('on'); break;
    case 'Escape': closeSettings(); $('blank').classList.remove('on'); if (screenName === 'home' && !$('modesCompetition').hidden) showModes('main'); break;
    case 'f': case 'F': toggleFull(); break;
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

const post = (type) => () => worker.postMessage({ type });
$('btnHome').onclick = goHome;
$('btnPrev').onclick = post('prev');
$('btnNext').onclick = post('next');
$('btnMute').onclick = () => setMuted(!muted);
$('btnBlank').onclick = () => $('blank').classList.toggle('on');
$('btnSettings').onclick = openSettings;
// Desktop app: the window goes full screen from the main process. Browser / Android: the page does.
function toggleFull() {
  if (window.api && window.api.toggleFullscreen) return window.api.toggleFullscreen();
  return document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
}
$('btnFull').onclick = toggleFull;
$('blank').addEventListener('click', () => $('blank').classList.remove('on'));
try { await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
screen('home');

// Updates, announcements and What's new (home screen only).
initNews({ $, store, onHome: () => screenName === 'home' });
