// Web only (added to the page by tools/web-build.mjs). Gives the page the same small "window.api" the
// desktop app has: settings in the browser's storage, announcements from GitHub. The site is always the
// latest version, so there is nothing to update.
(() => {
  const W = window.__SAMIA_WEB__;
  if (!W || window.api) return;
  const KEY = 'samia.settings';
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { settings = {}; }
  window.api = {
    settings: () => settings,
    setSetting: (k, v) => { settings[k] = v; try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage off */ } },
    info: () => ({ version: W.version, dev: false, canSelfUpdate: false }),
    latestRelease: async () => null,
    openReleases: () => window.open('https://github.com/Syncstanza/samia/releases/latest', '_blank'),
    announcements: async () => {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
        const r = await fetch('https://raw.githubusercontent.com/Syncstanza/samia/main/announcements.json', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (!r.ok) return [];
        const { cleanAnnouncements } = await import('./src/renderer/news-core.js');
        return cleanAnnouncements(await r.json());
      } catch { return []; }
    },
    selfUpdate: async () => ({ ok: false, error: 'unsupported' }),
    onUpdateProgress: () => {},
  };
  window.addEventListener('samia-ready', (e) => console.log('SAMIA_READY asr=' + (e.detail && e.detail.asr)));
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
