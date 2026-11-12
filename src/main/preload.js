'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('molv:event', (_event, message) => {
  for (const fn of Array.from(listeners)) {
    try { fn(message); } catch (_) {}
  }
});

contextBridge.exposeInMainWorld('molvDesktop', {
  isElectron: true,
  platform: process.platform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  invoke: (action, payload) => ipcRenderer.invoke('molv:invoke', action, payload),
  on: (fn) => {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  windowControl: (action) => ipcRenderer.invoke('molv:invoke', `window.${action}`),
});
