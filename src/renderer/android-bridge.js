// Android only (added to the page by tools/android-www.mjs, never loaded on desktop).
// Gives the page the same small "window.api" the desktop app has, so settings,
// the update check, announcements and What's new work the same way:
//   - settings: kept in the page's storage (https://localhost never changes, unlike the desktop server)
//   - updates: a new version opens the APK download in the browser; Android does the install
//   - the Back button steps out of a screen like Escape does, and leaves the app from home
(() => {
  const A = window.__SAMIA_ANDROID__;
  if (!A || window.api) return;
  const REPO = 'Syncstanza/samia';
  const KEY = 'samia.settings';
  const plugin = (n) => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[n]) || null;

  const getJson = async (url) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  };

  let settings = {};
  try { settings = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { settings = {}; }
  let apkUrl = '';

  window.api = {
    settings: () => settings,
    setSetting: (k, v) => {
      settings[k] = v;
      try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage off */ }
    },
    info: () => ({ version: A.version, dev: /-[a-z]+$/i.test(A.version), canSelfUpdate: false }),
    latestRelease: async () => {
      try {
        const r = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
        if (!r || r.draft || r.prerelease) return null;
        const assets = (r.assets || []).map((a) => ({ name: String(a.name || ''), url: String(a.browser_download_url || ''), size: Number(a.size) || 0 }));
        const { pickAsset } = await import('/src/renderer/news-core.js');
        const apk = pickAsset('apk', assets);
        apkUrl = apk ? apk.bin.url : '';
        return { version: String(r.tag_name || '').replace(/^v/, ''), url: String(r.html_url || ''), assets };
      } catch { return null; }
    },
    openReleases: () => {
      const url = apkUrl || `https://github.com/${REPO}/releases/latest`;
      // Hand the link to the phone's own browser (a normal download with the usual "Open" notification).
      // The in-app tab (Browser plugin) finishes the download but then sits on "Downloading..." with no way to install.
      window.location.href = url;
    },
    announcements: async () => {
      try {
        const { cleanAnnouncements } = await import('/src/renderer/news-core.js');
        return cleanAnnouncements(await getJson(`https://raw.githubusercontent.com/${REPO}/main/announcements.json`));
      } catch { return []; }
    },
    selfUpdate: async () => ({ ok: false, error: 'unsupported' }),
    onUpdateProgress: () => {},
  };

  // Back button: close whatever is open (like Escape), go home from a recitation, leave from home.
  const app = plugin('App');
  if (app && app.addListener) {
    app.addListener('backButton', () => {
      const b = document.body;
      const open = (id) => { const e = document.getElementById(id); return e && !e.hidden; };
      if (open('news')) {
        document.getElementById('newsClose').click();
      } else if (open('settings') || b.classList.contains('screen-setup') || open('modesCompetition')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const back = document.getElementById('setupCancel');
        if (b.classList.contains('screen-setup') && back) back.click();
      } else if (!b.classList.contains('screen-home')) {
        const home = document.getElementById('btnHome');
        if (home) home.click();
      } else {
        app.exitApp();
      }
    });
  }
  // A line the Android build test looks for (it proves the page and speech engine started).
  window.addEventListener('samia-ready', (e) => console.log('SAMIA_READY asr=' + (e.detail && e.detail.asr)));
})();
