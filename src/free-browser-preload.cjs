const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('freeBrowser', {
  navigate: value => ipcRenderer.send('free-browser:navigate', value),
  back: () => ipcRenderer.send('free-browser:back'),
  forward: () => ipcRenderer.send('free-browser:forward'),
  reload: () => ipcRenderer.send('free-browser:reload'),
  home: () => ipcRenderer.send('free-browser:home'),
  newTab: () => ipcRenderer.send('free-browser:new-tab'),
  selectTab: id => ipcRenderer.send('free-browser:select-tab', id),
  closeTab: id => ipcRenderer.send('free-browser:close-tab', id),
  onState: callback => ipcRenderer.on('free-browser:state', (_event, state) => callback(state)),
  onFocusAddress: callback => ipcRenderer.on('free-browser:focus-address', callback)
});
