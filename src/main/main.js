// Electron entry: starts the local server and opens the display full screen.
// Also: settings saved to a file, update check + update in place, announcements.
import { app, BrowserWindow, session, ipcMain, shell, net } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { startServer } from '../server.js';
import { cleanAnnouncements, pickAsset, isTestBuild, RELEASE_URL } from '../renderer/news-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = 'Syncstanza/samia';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const ANNOUNCEMENTS = `https://raw.githubusercontent.com/${REPO}/main/announcements.json`;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Test builds (version like "0.1.20-dev") keep their own settings, so trying
// one never changes the real app's settings on the same computer.
{
  const tag = /-([a-z]+)$/i.exec(app.getVersion());
  if (tag) app.setPath('userData', join(app.getPath('appData'), `Sami'a ${tag[1].toUpperCase()}`));
}

/* ---------- settings: a small JSON file in the app's folder ----------
   The page's own storage belongs to http://127.0.0.1:<port>, and the port is
   new every start, so it can't keep anything between starts. */
const SETTINGS_FILE = () => join(app.getPath('userData'), 'settings.json');
let settings = null;
let saveTimer = null;
function loadSettings() {
  if (settings) return settings;
  try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')); } catch { settings = {}; }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
  return settings;
}
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  clearTimeout(saveTimer);
  if (!settings) return;
  try {
    fs.mkdirSync(dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE() + '.tmp', JSON.stringify(settings));
    fs.renameSync(SETTINGS_FILE() + '.tmp', SETTINGS_FILE());
  } catch { /* disk full / read-only: settings just aren't kept */ }
}
ipcMain.on('settings:all', (e) => { e.returnValue = loadSettings(); });
ipcMain.on('settings:set', (_e, key, value) => {
  if (typeof key !== 'string' || key.length > 64) return;
  const s = loadSettings();
  if (value === undefined || value === null) delete s[key]; else s[key] = value;
  saveSoon();
});
app.on('before-quit', saveNow);

/* ---------- talking to GitHub ----------
   Through Electron's network layer (net.fetch), like a browser: it uses the
   computer's proxy settings, which school and office networks often need. */
const fetch = (url, opts) => net.fetch(url, opts);
async function getJson(url, timeoutMs = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': `Samia/${app.getVersion()}`, Accept: 'application/vnd.github+json' },
      signal: ctl.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// The newest published release: its version and downloads.
ipcMain.handle('app:latestRelease', async () => {
  try {
    const r = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!r || r.draft || r.prerelease) return null;
    return {
      version: String(r.tag_name || '').replace(/^v/, ''),
      url: String(r.html_url || ''),
      assets: (r.assets || []).map((a) => ({ name: String(a.name || ''), url: String(a.browser_download_url || ''), size: Number(a.size) || 0 })),
    };
  } catch { return null; }
});

ipcMain.handle('app:openReleases', () => shell.openExternal(RELEASES_PAGE));

/* ---------- announcements: announcements.json in the repo (see docs/RELEASING.md) ---------- */
ipcMain.handle('app:announcements', async () => {
  try { return cleanAnnouncements(await getJson(ANNOUNCEMENTS)); } catch { return []; }
});

/* ---------- update in place ----------
   Portable .exe and AppImage: download the new file next to the running one,
   check it against the checksum published with the release, swap it in (the
   old one is kept as ".old" until the new one runs) and restart. Installed
   copy: run the new setup program quietly; it installs over this one and
   starts the app again. */
let updating = false;
let quitting = false;

function installedWindows() {
  try {
    return process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE
      && fs.existsSync(join(dirname(process.execPath), 'Uninstall Samia.exe'));
  } catch { return false; }
}

function selfUpdateTarget() {
  if (isTestBuild(app.getVersion())) return null; // test builds update by downloading the next test build
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE) return { kind: 'portable', file: process.env.PORTABLE_EXECUTABLE_FILE };
  if (installedWindows()) return { kind: 'installer' };
  if (process.platform === 'linux' && process.env.APPIMAGE) return { kind: 'appimage', file: process.env.APPIMAGE };
  return null;
}

ipcMain.on('app:info', (e) => {
  e.returnValue = { version: app.getVersion(), dev: isTestBuild(app.getVersion()), canSelfUpdate: !!selfUpdateTarget() };
});

ipcMain.handle('app:selfUpdate', async (e) => {
  const T = selfUpdateTarget();
  if (!T) return { ok: false, error: 'unsupported' };
  if (updating) return { ok: false, error: 'busy' };
  updating = true;
  const send = (pct) => { try { e.sender.send('app:updateProgress', pct); } catch { /* window gone */ } };
  const tmp = T.kind === 'installer' ? join(os.tmpdir(), 'Samia-update.exe') : T.file + '.new';
  try {
    const rel = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`, 15000);
    const assets = ((rel && rel.assets) || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
    const pick = pickAsset(T.kind, assets);
    if (!pick || !pick.sum) { updating = false; return { ok: false, error: 'nochecksum' }; }
    for (const a of [pick.bin, pick.sum]) if (!RELEASE_URL.test(String(a.url || ''))) throw new Error('unexpected download address');

    const want = ((await (await fetch(pick.sum.url)).text()).match(/[0-9a-f]{64}/i) || [''])[0].toLowerCase();
    if (!want) throw new Error('no checksum');

    const res = await fetch(pick.bin.url);
    if (!res.ok || !res.body) throw new Error('download failed');
    const total = Number(res.headers.get('content-length')) || pick.bin.size || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(tmp);
    let got = 0, last = -1;
    for await (const chunk of res.body) {
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      got += chunk.length;
      const pct = total ? Math.min(99, Math.floor((got / total) * 100)) : 0;
      if (pct !== last) { last = pct; send(pct); }
    }
    await new Promise((r, j) => { out.once('error', j); out.end(r); });
    if (got < 5 * 1024 * 1024 || hash.digest('hex') !== want) throw new Error('checksum mismatch');

    saveNow();
    if (T.kind === 'installer') {
      send(100);
      spawn(tmp, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      quitting = true;
      app.releaseSingleInstanceLock();
      setTimeout(() => app.quit(), 400);
      return { ok: true };
    }

    // A running file can be renamed (Windows and Linux both allow it): move the old one aside, put the new one in its place.
    const old = T.file + '.old';
    try { fs.rmSync(old, { force: true }); } catch { /* ignore */ }
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o755);
    fs.renameSync(T.file, old);
    try { fs.renameSync(tmp, T.file); } catch (err) { try { fs.renameSync(old, T.file); } catch { /* ignore */ } throw err; }
    send(100);

    // Start the new copy a moment after this one has exited.
    const env = { ...process.env };
    for (const k of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD', 'PORTABLE_EXECUTABLE_FILE', 'PORTABLE_EXECUTABLE_DIR', 'PORTABLE_EXECUTABLE_APP_FILENAME']) delete env[k];
    const flags = process.argv.filter((a) => a === '--no-sandbox' || a === '--window');
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', `ping -n 3 127.0.0.1 >nul & start "" "${T.file}" ${flags.join(' ')}`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, env })
      : spawn('/bin/sh', ['-c', 'sleep 1.5; exec "$0" "$@"', T.file, ...flags], { detached: true, stdio: 'ignore', env });
    child.unref();
    quitting = true;
    app.releaseSingleInstanceLock();
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  } catch (err) {
    updating = false;
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// After an update the previous version is left beside the new one; once the new one runs it isn't needed.
function cleanupOldBuild() {
  const T = selfUpdateTarget();
  if (!T || !T.file) return;
  for (const f of [T.file + '.old', T.file + '.new']) { try { fs.rmSync(f, { force: true }); } catch { /* still in use: next start */ } }
}

/* ---------- the window ---------- */
let win = null;

async function open() {
  // Microphone / line-in permission is granted to our own page only.
  const ours = (url) => typeof url === 'string' && url.startsWith('http://127.0.0.1:');
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => {
    done(permission === 'media' && ours(wc.getURL()));
  });
  // Also answer "may I?" checks, so the input list shows real microphone names.
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => {
    return permission === 'media' && ours(origin || (wc && wc.getURL()));
  });

  // Test recordings go straight to the Downloads folder.
  session.defaultSession.on('will-download', (event, item) => {
    item.setSavePath(join(app.getPath('downloads'), item.getFilename()));
  });

  const server = await startServer(0);
  const { port } = server.address();
  const kiosk = process.argv.includes('--kiosk'); // starts in a window; --kiosk starts full screen (for a dedicated display PC)

  ipcMain.removeHandler('win:toggleFullscreen');
  ipcMain.handle('win:toggleFullscreen', () => {
    if (!win || win.isDestroyed()) return false;
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });

  win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#0b1215',
    fullscreen: kiosk,
    autoHideMenuBar: true,
    title: "Sami'a",
    webPreferences: { contextIsolation: true, sandbox: true, preload: join(HERE, 'preload.cjs') },
  });
  // Links (the releases page) open in the normal browser, never inside the display.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

// One copy at a time (two would fight over the microphone): a second start brings the first one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    loadSettings();
    setTimeout(cleanupOldBuild, 8000);
    return open();
  });
}
app.on('window-all-closed', () => { if (!quitting) saveNow(); app.quit(); });
