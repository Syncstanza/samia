// The intro: the arch draws itself, the sound bars rise, the name and the opening line appear,
// then the logo, name and tagline glide to where they sit on the home screen while the
// three mode cards rise in. Any key, click or tap skips it. Settings can turn it off.
// It never delays the app: the speech engine loads underneath while it plays.
//
// This file runs on its own, ahead of the app's own scripts, so the intro starts at once even while
// the speech engine and the rest of the app are still loading. (If it ever fails to start, a CSS
// timer in styles.css removes the intro after a few seconds, so it can never block the app.)
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) {
    try {
      if (window.api && window.api.settings) { const s = window.api.settings(); return k in s ? s[k] : d; }
      const v = localStorage.getItem('samia.' + k); return v === null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) {
    try {
      if (window.api && window.api.setSetting) window.api.setSetting(k, v);
      else localStorage.setItem('samia.' + k, JSON.stringify(v));
    } catch { /* storage off */ }
  },
};

function initIntro() {
  const root = $('intro');
  const home = $('home');
  const box = $('introShow');
  const on = store.get('showIntro', true) !== false;
  box.checked = on;
  box.onchange = () => store.set('showIntro', box.checked);
  document.querySelectorAll('#modesMain .mode').forEach((m, i) => m.style.setProperty('--i', i));

  const q = new URLSearchParams(location.search);
  // (Windows' "animation effects" switch makes the browser report reduced motion, which hid the intro for
  // everyone with it off. The intro is short, skippable and has its own switch in Settings, so it plays anyway.)
  const off = !on || q.has('demo') || q.has('nointro');
  if (off) { root.remove(); return; }

  home.classList.add('intro-hold', 'cards-hold');
  root.classList.add('run');

  const logo = root.querySelector('.intro-logo');
  const title = root.querySelector('.intro-title');
  const tag = root.querySelector('.intro-tag');
  const timers = [];
  const later = (f, ms) => timers.push(setTimeout(f, ms));
  let done = false;

  const flip = (el, target, ms) => {
    const a = el.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const s = a.width ? b.width / a.width : 1;
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    el.animate(
      [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }],
      { duration: ms, easing: 'cubic-bezier(.65, 0, .25, 1)', fill: 'forwards' },
    );
  };

  const stop = () => {
    done = true;
    timers.forEach(clearTimeout);
    removeEventListener('keydown', onKey, true);
  };
  const release = () => { home.classList.remove('intro-hold', 'cards-hold'); root.remove(); };

  const handoff = () => {
    root.classList.add('go');
    flip(logo, home.querySelector('.home-logo'), 1000);
    flip(title, home.querySelector('h1'), 1000);
    flip(tag, home.querySelector('.tagline'), 1000);
    later(() => { home.classList.remove('cards-hold'); home.classList.add('intro-in'); }, 500);
    later(() => { stop(); release(); setTimeout(() => home.classList.remove('intro-in'), 1800); }, 1000);
  };

  const skip = () => {
    if (done) return;
    stop();
    home.classList.remove('intro-hold', 'cards-hold');
    root.style.transition = 'opacity .25s ease';
    root.style.opacity = '0';
    setTimeout(() => root.remove(), 280);
  };
  function onKey(e) { e.preventDefault(); e.stopImmediatePropagation(); skip(); }
  addEventListener('keydown', onKey, true);
  root.addEventListener('pointerdown', skip);

  later(() => logo.classList.add('png'), 2300);
  later(handoff, 3300);
}

initIntro();
