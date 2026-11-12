// Updates, announcements and What's new (as in Lyric Player).
//   - Update: checks GitHub for a newer release a little after start and every
//     6 hours; "Update available" shows on the home screen only (never over a
//     recitation). One click downloads, checks and installs it, then restarts.
//   - Announcements: announcements.json in the repo, read a little after start
//     and every 6 hours; a dismissible bar on the home screen.
//   - What's new: once, the first time a newer version is opened.
// Everything here needs the app (window.api); in a plain browser it stays quiet.
import { isNewer } from './news-core.js';
import { WHATS_NEW } from './whatsnew.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;

export function initNews({ $, store, onHome }) {
  const api = window.api || null;
  const info = api ? api.info() : null;
  let update = null;   // the newer release, once found
  let updating = false;

  // ---------------------------------------------------------------- toast
  let toastTimer = null;
  function toast(text, ms = 5000) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------------------------------------------------------------- dialog
  function showDialog(title, nodes) {
    $('newsTitle').textContent = title;
    $('newsBody').replaceChildren(...nodes);
    $('news').hidden = false;
    $('newsClose').focus({ preventScroll: true });
    $('newsBody').parentElement.scrollTop = 0; // start at the top of the list
  }
  const closeDialog = () => { $('news').hidden = true; };
  $('newsClose').onclick = closeDialog;
  $('news').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeDialog(); } });
  const el = (tag, text, cls) => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };

  // ---------------------------------------------------------------- version
  $('aboutVersion').textContent = info
    ? `Version ${info.version}${info.dev ? ' (test build)' : ''} · Syncstanza`
    : 'Sami\'a · Syncstanza';

  // ---------------------------------------------------------------- what's new
  function whatsNew(lastSeen, latestOnly) {
    const entries = latestOnly ? WHATS_NEW.slice(0, 1) : WHATS_NEW.filter((e) => e.id > lastSeen).slice(0, 3);
    if (!entries.length) return;
    const nodes = [];
    for (const e of entries) {
      if (entries.length > 1 || latestOnly) nodes.push(el('h3', `${e.title}${e.version ? ' · ' + e.version : ''}`));
      const ul = document.createElement('ul');
      for (const t of e.items) ul.append(el('li', t));
      nodes.push(ul);
    }
    showDialog("What's new", nodes);
  }
  $('btnWhatsNew').onclick = () => whatsNew(0, true);
  {
    const newest = WHATS_NEW[0].id;
    const lastSeen = Number(store.get('lastSeenNews', 0)) || 0;
    const brandNew = store.get('seenApp', false) !== true; // a new install has nothing to compare with
    store.set('seenApp', true);
    if (newest > lastSeen) {
      store.set('lastSeenNews', newest);
      if (!brandNew) setTimeout(() => { if (onHome()) whatsNew(lastSeen); }, 2500);
    }
  }

  // ---------------------------------------------------------------- updates
  function showUpdate(rel) {
    update = rel;
    $('btnUpdate').textContent = `Update to ${rel.version}`;
    $('btnUpdate').hidden = false;
    $('btnCheckUpdate').textContent = `Update to ${rel.version}`;
  }
  async function check(manual) {
    const say = (m) => { if (manual) toast(m); };
    if (!api) return say('Updates work in the installed app.');
    if (info.dev) return say('This is a test build: new test builds are on the Releases page.');
    if (manual) toast('Checking for updates…', 3000);
    const rel = await api.latestRelease().catch(() => null);
    if (!rel || !rel.version) return say("Couldn't reach GitHub right now. Try again in a minute.");
    store.set('updateCheckedAt', Date.now());
    if (isNewer(rel.version, info.version)) {
      showUpdate(rel);
      if (manual) toast(`Version ${rel.version} is available.`);
    } else {
      say(`You're on the newest version (${info.version}).`);
    }
  }
  async function install() {
    if (!update || updating) return;
    if (!info.canSelfUpdate) {
      api.openReleases();
      toast(`Opening the download page for ${update.version} in your browser.`, 8000);
      return;
    }
    updating = true;
    $('btnUpdate').textContent = 'Updating… 0%';
    toast('Downloading the update. Sami\'a restarts by itself when it is ready.', 7000);
    const r = await api.selfUpdate().catch(() => ({ ok: false }));
    if (r && r.ok) return;
    updating = false;
    $('btnUpdate').textContent = `Update to ${update.version}`;
    api.openReleases();
    toast("Couldn't update in place, so the download page is opening instead.", 8000);
  }
  if (api) api.onUpdateProgress((pct) => { $('btnUpdate').textContent = pct >= 100 ? 'Restarting…' : `Updating… ${pct}%`; });
  $('btnUpdate').onclick = install;
  $('btnCheckUpdate').onclick = () => (update ? install() : check(true));
  if (api && !info.dev) {
    setTimeout(() => check(false), 15000);
    setInterval(() => check(false), SIX_HOURS); // masjid PCs stay on for days
  }

  // ---------------------------------------------------------------- announcements
  let annList = null;
  let showAnn = store.get('showAnnouncements', true) !== false;
  async function fetchAnn() {
    try { annList = (api && (await api.announcements())) || []; } catch { annList = []; }
    return annList;
  }
  async function checkAnn() {
    if (!api || !showAnn) return;
    const list = await fetchAnn();
    const seen = Number(store.get('annSeen', 0)) || 0;
    const a = list.find((x) => x.id > seen);
    if (!a) { $('annBar').hidden = true; return; }
    $('annText').textContent = (a.title ? a.title + ': ' : '') + a.text;
    $('annBar').dataset.id = String(list[0].id); // dismissing marks the newest as read
    $('annBar').hidden = false;
  }
  $('annClose').onclick = () => {
    store.set('annSeen', Number($('annBar').dataset.id) || 0);
    $('annBar').hidden = true;
  };
  $('btnAnn').onclick = async () => {
    if (!api) return toast('Announcements work in the installed app.');
    const list = annList || (await fetchAnn());
    if (!list.length) return toast('No announcements right now.');
    const nodes = [];
    for (const a of list) {
      if (a.title) nodes.push(el('h3', a.title + (a.date ? ' · ' + a.date : '')));
      nodes.push(el('p', a.text));
    }
    store.set('annSeen', list[0].id);
    $('annBar').hidden = true;
    showDialog('Announcements', nodes);
  };
  $('annShow').checked = showAnn;
  $('annShow').onchange = () => {
    showAnn = $('annShow').checked;
    store.set('showAnnouncements', showAnn);
    if (showAnn) checkAnn(); else $('annBar').hidden = true;
  };
  if (api) {
    setTimeout(checkAnn, 20000);
    setInterval(checkAnn, SIX_HOURS);
  }

  return { toast };
}
