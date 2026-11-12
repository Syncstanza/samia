// Small pure helpers for updates and announcements, shared by the app (Electron
// main process), the page and the tests.

/** "1.2.0" -> [1, 2, 0]; null for anything that isn't a release version (e.g. "0.1.19-dev"). */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Is release version `latest` newer than `current`? */
export function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** A test build (dev / taraweeh) has a version like "0.1.19-dev": it never offers updates. */
export const isTestBuild = (version) => !parseVersion(version);

/**
 * announcements.json -> at most 5 announcements, newest first. Anything odd is
 * dropped (bad id, no text, past its "until" date); text is plain and capped.
 */
export function cleanAnnouncements(json, now = Date.now()) {
  const list = json && Array.isArray(json.items) ? json.items : [];
  const out = [];
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const id = Number(a.id);
    const text = typeof a.text === 'string' ? a.text.trim().slice(0, 600) : '';
    if (!Number.isInteger(id) || id < 1 || !text) continue;
    if (typeof a.until === 'string' && Date.parse(a.until) < now) continue;
    out.push({
      id,
      title: typeof a.title === 'string' ? a.title.trim().slice(0, 80) : '',
      text,
      date: typeof a.date === 'string' ? a.date.slice(0, 10) : '',
    });
  }
  out.sort((x, y) => y.id - x.id);
  return out.slice(0, 5);
}

/** The download for this kind of copy: 'portable' | 'installer' | 'appimage' | 'apk'. */
export function pickAsset(kind, assets) {
  const want = {
    portable: /^Samia-\d+\.\d+\.\d+\.exe$/i,
    installer: /^Samia-Setup-\d+\.\d+\.\d+\.exe$/i,
    appimage: /^Samia-\d+\.\d+\.\d+\.AppImage$/i,
    apk: /^Samia-\d+\.\d+\.\d+\.apk$/i,
  }[kind];
  if (!want) return null;
  const bin = (assets || []).find((a) => want.test(String(a.name || '')));
  if (!bin) return null;
  const sum = assets.find((a) => a.name === bin.name + '.sha256') || null;
  return { bin, sum };
}

/** Only downloads from this repo's releases are ever fetched (any owner name: the account can be renamed). */
export const RELEASE_URL = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/samia\/releases\//i;
