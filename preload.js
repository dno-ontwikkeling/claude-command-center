'use strict';

const { contextBridge, ipcRenderer, clipboard } = require('electron');

/**
 * The renderer-facing API. Shape is defined once in types/ipc.d.ts (as
 * window.api). `npm run typecheck` checks THIS object literal (via the
 * `@type` annotation below) against that contract, so a preload pass-through
 * whose `ipcRenderer.invoke(channel, ...)` return shape drifts from the
 * matching Api method here is caught at the preload<->contract boundary
 * (see types/electron.d.ts's InvokeChannelMap). Renderer call sites
 * (renderer/**\/*.js) and the main-process handlers themselves (main.js) are
 * NOT part of this typecheck — they are plain, unchecked JS, so drift
 * introduced purely in main.js's handler bodies, or in how renderer code
 * consumes window.api, will not be caught here.
 * @type {import('./types/ipc').Api}
 */
const api = {
  // projects
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: () => ipcRenderer.invoke('projects:add'),
  removeProject: (dir) => ipcRenderer.invoke('projects:remove', dir),
  reorderProjects: (dirs) => ipcRenderer.invoke('projects:reorder', dirs),

  // workspaces (scratch folders, no git)
  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  createWorkspace: (name) => ipcRenderer.invoke('workspaces:create', name),
  removeWorkspace: (dir) => ipcRenderer.invoke('workspaces:remove', dir),
  reorderWorkspaces: (dirs) => ipcRenderer.invoke('workspaces:reorder', dirs),

  // worktrees
  listWorktrees: (dir) => ipcRenderer.invoke('projects:worktrees', dir),
  listBranches: (dir) => ipcRenderer.invoke('branches:list', dir),
  createWorktree: (opts) => ipcRenderer.invoke('worktree:create', opts),
  removeWorktree: (dir, path, force) => ipcRenderer.invoke('worktree:remove', { dir, path, force }),
  gitFetch: (cwd) => ipcRenderer.invoke('git:fetch', cwd),
  gitPull: (cwd) => ipcRenderer.invoke('git:pull', cwd),
  gitDiffStat: (cwd) => ipcRenderer.invoke('git:diffstat', cwd),
  gitDiff: (cwd, mode) => ipcRenderer.invoke('git:diff', { cwd, mode }),
  gitBranch: (cwd) => ipcRenderer.invoke('git:branch', cwd),
  gitDeleteBranch: (dir, branch) => ipcRenderer.invoke('git:delete-branch', { dir, branch }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openInVS: (cwd) => ipcRenderer.invoke('vs:open', cwd),
  openInVSCode: (cwd) => ipcRenderer.invoke('code:open', cwd),
  openInExplorer: (cwd) => ipcRenderer.invoke('explorer:open', cwd),

  // clipboard
  readClipboard: () => clipboard.readText(),
  writeClipboard: (text) => clipboard.writeText(text),

  // logging (renderer -> main log file)
  log: (level, args) => ipcRenderer.send('log', { level, args }),

  // git-change watchers: register the dirs to watch; main pushes 'git:changed'
  setWatchDirs: (dirs) => ipcRenderer.send('watch:set', dirs),
  onGitChanged: (cb) => ipcRenderer.on('git:changed', (_e, payload) => cb(payload)),

  // agents
  spawn: (id, cwd, opts) => ipcRenderer.invoke('agent:spawn', { id, cwd, opts }),
  sendInput: (id, data) => ipcRenderer.send('agent:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('agent:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.send('agent:kill', { id }),

  // streams (main -> renderer)
  onData: (cb) => ipcRenderer.on('agent:data', (_e, p) => cb(p)),
  onExit: (cb) => ipcRenderer.on('agent:exit', (_e, p) => cb(p)),
  onEvent: (cb) => ipcRenderer.on('agent:event', (_e, p) => cb(p)),
};

contextBridge.exposeInMainWorld('api', api);
