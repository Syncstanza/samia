// Electron entry: starts the local server and opens the display full screen.
import { app, BrowserWindow, session } from 'electron';
import { startServer } from '../server.js';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

async function open() {
  // Microphone / line-in permission is granted to our own page only.
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => {
    done(permission === 'media' && wc.getURL().startsWith('http://127.0.0.1:'));
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
