'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // projects
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: () => ipcRenderer.invoke('projects:add'),
  removeProject: (dir) => ipcRenderer.invoke('projects:remove', dir),

  // worktrees
  listWorktrees: (dir) => ipcRenderer.invoke('projects:worktrees', dir),
  listBranches: (dir) => ipcRenderer.invoke('branches:list', dir),
  createWorktree: (dir, branch, newBranch) =>
    ipcRenderer.invoke('worktree:create', { dir, branch, newBranch }),
  removeWorktree: (dir, path, force) => ipcRenderer.invoke('worktree:remove', { dir, path, force }),

  // agents
  spawn: (id, cwd, opts) => ipcRenderer.invoke('agent:spawn', { id, cwd, opts }),
  sendInput: (id, data) => ipcRenderer.send('agent:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('agent:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.send('agent:kill', { id }),

  // streams (main -> renderer)
  onData: (cb) => ipcRenderer.on('agent:data', (_e, p) => cb(p)),
  onExit: (cb) => ipcRenderer.on('agent:exit', (_e, p) => cb(p)),
  onEvent: (cb) => ipcRenderer.on('agent:event', (_e, p) => cb(p)),
});
