const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (fn) => ipcRenderer.on(ch, (_e, data) => fn(data));

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  setPage: (url) => ipcRenderer.send('set-page', url),
  download: (req) => ipcRenderer.invoke('download', req),
  batchAction: (id, action) => ipcRenderer.send('batch-action', { id, action }),
  clearDone: () => ipcRenderer.send('clear-done'),
  openPath: (p) => ipcRenderer.send('open-path', p),
  openSaveDir: () => ipcRenderer.send('open-save-dir'),
  pickSaveDir: () => ipcRenderer.invoke('pick-save-dir'),
  setSetting: (key, value) => ipcRenderer.send('set-setting', { key, value }),
  setReferers: (list) => ipcRenderer.send('set-referers', list),
  fetchHtml: (url, referer) => ipcRenderer.invoke('fetch-html', { url, referer }),
  filePlan: (name) => ipcRenderer.invoke('file-plan', name),
  setTypeDir: (cat, dir) => ipcRenderer.invoke('set-type-dir', { cat, dir }),
  pickDir: (start) => ipcRenderer.invoke('pick-dir', start),
  openFile: (p) => ipcRenderer.send('open-file', p),
  setAutoStart: (on) => ipcRenderer.invoke('set-auto-start', on),
  copyExtensionDir: () => ipcRenderer.invoke('copy-extension-dir'),
  popupInit: () => ipcRenderer.invoke('popup-init'),
  popupLater: () => ipcRenderer.send('popup-later'),
  onOpenUrl: on('open-url'),
  updateAction: () => ipcRenderer.send('update-action'),
  onCaptured: on('captured'),
  onDownloads: on('downloads'),
  onUpdate: on('update'),
  onShortcut: on('shortcut'),
  onPopup: on('popup'),
});
