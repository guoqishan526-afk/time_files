const { contextBridge } = require('electron');

// Expose a minimal API if needed by renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true
});
