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
  updateAction: () => ipcRenderer.send('update-action'),
  onCaptured: on('captured'),
  onDownloads: on('downloads'),
  onUpdate: on('update'),
  onShortcut: on('shortcut'),
  onPopup: on('popup'),
});
