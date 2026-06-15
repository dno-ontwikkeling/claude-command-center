'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cc', {
  // queries / actions
  listAgents: () => ipcRenderer.invoke('agents:list'),
  spawnAgent: (opts) => ipcRenderer.invoke('agent:spawn', opts),
  sendInput: (id, data) => ipcRenderer.invoke('agent:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.invoke('agent:resize', { id, cols, rows }),
  killAgent: (id) => ipcRenderer.invoke('agent:kill', { id }),
  removeAgent: (id) => ipcRenderer.invoke('agent:remove', { id }),
  restartAgent: (id) => ipcRenderer.invoke('agent:restart', { id }),
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  appInfo: () => ipcRenderer.invoke('app:info'),

  // events
  onData: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('pty:data', h);
    return () => ipcRenderer.removeListener('pty:data', h);
  },
  onExit: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('pty:exit', h);
    return () => ipcRenderer.removeListener('pty:exit', h);
  },
  onAgentsChanged: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('agents:changed', h);
    return () => ipcRenderer.removeListener('agents:changed', h);
  },
});
