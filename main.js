'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const pty = require('@lydell/node-pty');

// ---------------------------------------------------------------------------
// claude executable resolution
// ---------------------------------------------------------------------------

function resolveClaude() {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {
      /* ignore */
    }
  }
  // Fall back to PATH lookup; node-pty resolves it on Windows.
  return process.platform === 'win32' ? 'claude.exe' : 'claude';
}

const CLAUDE_BIN = resolveClaude();
const DEFAULT_SHELL =
  process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';

// ---------------------------------------------------------------------------
// Status detection
// ---------------------------------------------------------------------------

const IDLE_MS = 1500; // no output for this long => not busy
// Patterns that suggest the agent is blocked waiting for the user.
const NEEDS_INPUT_RE =
  /(\(y\/n\))|(\[y\/N\])|(Do you want)|(Press Enter)|(❯)|(➤)|(>\s*$)|(\? )/i;

function stripAnsi(s) {
  // Remove ANSI escape sequences for clean "last activity" text.
  return s.replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1B\][^\x07]*\x07/g, '');
}

// ---------------------------------------------------------------------------
// Agent Manager
// ---------------------------------------------------------------------------

let nextId = 1;
const agents = new Map();
let mainWindow = null;

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function agentSummary(a) {
  return {
    id: a.id,
    name: a.name,
    projectDir: a.projectDir,
    status: a.status,
    lastActivity: a.lastActivity,
    lastLine: a.lastLine,
    exitCode: a.exitCode,
    kind: a.kind,
  };
}

function emitAgents() {
  broadcast('agents:changed', [...agents.values()].map(agentSummary));
}

function setStatus(a, status) {
  if (a.status === status) return;
  a.status = status;
  emitAgents();
}

function scheduleIdleCheck(a) {
  if (a.idleTimer) clearTimeout(a.idleTimer);
  a.idleTimer = setTimeout(() => {
    if (a.status === 'exited') return;
    // If recent buffer looks like a prompt, mark needs-input, else idle.
    if (NEEDS_INPUT_RE.test(a.tail)) setStatus(a, 'needs-input');
    else setStatus(a, 'idle');
  }, IDLE_MS);
}

function spawnAgent({ name, projectDir, kind }) {
  const id = nextId++;
  const cwd = projectDir && fs.existsSync(projectDir) ? projectDir : os.homedir();
  const command = kind === 'shell' ? DEFAULT_SHELL : CLAUDE_BIN;
  const args = [];

  const p = pty.spawn(command, args, {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd,
    env: { ...process.env },
  });

  const a = {
    id,
    name: name || path.basename(cwd) || `agent-${id}`,
    projectDir: cwd,
    kind: kind === 'shell' ? 'shell' : 'claude',
    pty: p,
    status: 'busy',
    lastActivity: Date.now(),
    lastLine: '',
    tail: '', // recent stripped output, capped
    exitCode: null,
    idleTimer: null,
  };
  agents.set(id, a);

  p.onData((data) => {
    a.lastActivity = Date.now();
    setStatus(a, 'busy');

    // Maintain a small tail buffer of clean text for status + last line.
    a.tail = (a.tail + stripAnsi(data)).slice(-2000);
    const lines = a.tail.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length) a.lastLine = lines[lines.length - 1].slice(0, 200);

    broadcast('pty:data', { id, data });
    scheduleIdleCheck(a);
    emitAgents();
  });

  p.onExit(({ exitCode }) => {
    a.exitCode = exitCode;
    a.status = 'exited';
    if (a.idleTimer) clearTimeout(a.idleTimer);
    broadcast('pty:exit', { id, exitCode });
    emitAgents();
  });

  emitAgents();
  return agentSummary(a);
}

function killAgent(id) {
  const a = agents.get(id);
  if (!a) return false;
  try {
    a.pty.kill();
  } catch (_) {
    /* already dead */
  }
  return true;
}

function removeAgent(id) {
  const a = agents.get(id);
  if (!a) return false;
  try {
    a.pty.kill();
  } catch (_) {
    /* ignore */
  }
  if (a.idleTimer) clearTimeout(a.idleTimer);
  agents.delete(id);
  emitAgents();
  return true;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle('agents:list', () =>
  [...agents.values()].map(agentSummary)
);

ipcMain.handle('agent:spawn', (_e, opts) => spawnAgent(opts || {}));

ipcMain.handle('agent:input', (_e, { id, data }) => {
  const a = agents.get(id);
  if (a && a.status !== 'exited') {
    a.pty.write(data);
    return true;
  }
  return false;
});

ipcMain.handle('agent:resize', (_e, { id, cols, rows }) => {
  const a = agents.get(id);
  if (a && a.status !== 'exited') {
    try {
      a.pty.resize(cols, rows);
    } catch (_) {
      /* ignore */
    }
  }
});

ipcMain.handle('agent:kill', (_e, { id }) => killAgent(id));
ipcMain.handle('agent:remove', (_e, { id }) => removeAgent(id));

ipcMain.handle('agent:restart', (_e, { id }) => {
  const a = agents.get(id);
  if (!a) return null;
  const opts = { name: a.name, projectDir: a.projectDir, kind: a.kind };
  removeAgent(id);
  return spawnAgent(opts);
});

ipcMain.handle('dialog:pickDir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Pick project folder',
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('app:info', () => ({
  claudeBin: CLAUDE_BIN,
  shell: DEFAULT_SHELL,
  platform: process.platform,
}));

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#282c34',
    title: 'Claude Command Center',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const a of agents.values()) {
    try {
      a.pty.kill();
    } catch (_) {
      /* ignore */
    }
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
