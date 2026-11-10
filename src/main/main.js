// Electron entry: starts the local server and opens the display full screen.
import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { startServer } from '../server.js';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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
  const kiosk = !process.argv.includes('--window');

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#0b1215',
    fullscreen: kiosk,
    kiosk,
    autoHideMenuBar: true,
    title: "Sami'a",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(open);
app.on('window-all-closed', () => app.quit());
