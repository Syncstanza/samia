// The bridge between the page and the app (Electron only; in a plain browser
// window.api is missing and the page keeps working without these features).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  // Settings live in a file in the app's folder: the page's own storage is
  // tied to the local server's port, which changes every start.
  settings: () => ipcRenderer.sendSync('settings:all'),
  setSetting: (key, value) => ipcRenderer.send('settings:set', key, value),

  info: () => ipcRenderer.sendSync('app:info'), // { version, dev, canSelfUpdate }
  latestRelease: () => ipcRenderer.invoke('app:latestRelease'),
  selfUpdate: () => ipcRenderer.invoke('app:selfUpdate'),
  onUpdateProgress: (fn) => ipcRenderer.on('app:updateProgress', (_e, pct) => fn(pct)),
  openReleases: () => ipcRenderer.invoke('app:openReleases'),
  announcements: () => ipcRenderer.invoke('app:announcements'),
});
