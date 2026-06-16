'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');
const pty = require('@lydell/node-pty');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Map<string, import('@lydell/node-pty').IPty>} */
const agents = new Map();
let mainWindow = null;
let serverPort = 0;

const PROJECTS_FILE = path.join(app.getPath('userData'), 'projects.json');
// In a packaged build the hook script is unpacked from the asar so `node` can
// actually execute it (you cannot run a file from inside the virtual asar).
const REPORT_SCRIPT = path
  .join(__dirname, 'hooks', 'report.js')
  .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

// Lifecycle events we hook, mapped to the status the agent should report.
const HOOK_EVENTS = {
  SessionStart: 'busy',
  UserPromptSubmit: 'busy',
  PreToolUse: 'busy',
  Notification: 'needs-input',
  Stop: 'idle',
  SessionEnd: 'dead',
};

// ---------------------------------------------------------------------------
// Project persistence
// ---------------------------------------------------------------------------

function loadProjects() {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveProjects(projects) {
  fs.mkdirSync(path.dirname(PROJECTS_FILE), { recursive: true });
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// ---------------------------------------------------------------------------
// Git branch (no git dependency — read .git/HEAD; handles worktrees)
// ---------------------------------------------------------------------------

function gitBranch(dir) {
  try {
    const dotGit = path.join(dir, '.git');
    const stat = fs.statSync(dotGit);
    let headFile;
    if (stat.isDirectory()) {
      headFile = path.join(dotGit, 'HEAD');
    } else {
      // worktree: .git is a file "gitdir: <path>"
      const gitdir = fs.readFileSync(dotGit, 'utf8').replace('gitdir:', '').trim();
      headFile = path.join(gitdir, 'HEAD');
    }
    const head = fs.readFileSync(headFile, 'utf8').trim();
    if (head.startsWith('ref:')) return head.replace('ref: refs/heads/', '');
    return head.slice(0, 7); // detached HEAD -> short sha
  } catch {
    return null;
  }
}

function isGitRepo(dir) {
  return gitBranch(dir) !== null;
}

// List all worktrees of a repo. Each worktree has its own path (which may live
// anywhere on disk) and its own branch.
function listWorktrees(dir) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'worktree', 'list', '--porcelain'], (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }
      const worktrees = [];
      let cur = null;
      for (const line of stdout.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
          cur = { path: line.slice(9), branch: null };
          worktrees.push(cur);
        } else if (line.startsWith('branch ') && cur) {
          cur.branch = line.slice(7).replace('refs/heads/', '');
        }
      }
      // git lists the main working tree first; it cannot be removed.
      if (worktrees.length) worktrees[0].isMain = true;
      resolve(worktrees);
    });
  });
}

function listBranches(dir) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'branch', '--format=%(refname:short)'], (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Claude executable resolution
// ---------------------------------------------------------------------------

function resolveClaude() {
  const bin = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const local = path.join(os.homedir(), '.local', 'bin', bin);
  if (fs.existsSync(local)) return local;
  return bin; // fall back to PATH
}

// ---------------------------------------------------------------------------
// Global hook installation (env-gated: only app-launched agents report)
// ---------------------------------------------------------------------------

function settingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function hooksInstalled(settings) {
  return JSON.stringify(settings.hooks || {}).includes('report.js');
}

async function ensureHooksInstalled() {
  const file = settingsPath();
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    settings = {};
  }

  if (hooksInstalled(settings)) return;

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Install', 'Skip'],
    defaultId: 0,
    cancelId: 1,
    title: 'Command Center setup',
    message: 'Install status hooks into ~/.claude/settings.json?',
    detail:
      'Adds lifecycle hooks so agents launched from Command Center report their ' +
      'status (busy / needs-input / idle). Hooks are gated on an environment ' +
      'variable, so sessions you open manually are unaffected.',
  });
  if (response !== 0) return;

  settings.hooks = settings.hooks || {};
  for (const [event, status] of Object.entries(HOOK_EVENTS)) {
    const command = `node "${REPORT_SCRIPT}" ${status}`;
    settings.hooks[event] = settings.hooks[event] || [];
    settings.hooks[event].push({ hooks: [{ type: 'command', command }] });
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}

// ---------------------------------------------------------------------------
// Local HTTP server — receives hook events, forwards to renderer
// ---------------------------------------------------------------------------

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/event') {
        res.writeHead(404).end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const event = JSON.parse(body);
          mainWindow?.webContents.send('agent:event', event);
        } catch {
          /* ignore malformed */
        }
        res.writeHead(200).end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Agent (PTY) management
// ---------------------------------------------------------------------------

function spawnAgent(id, cwd, opts = {}) {
  const shell = resolveClaude();
  // `--resume <id>` reopens a prior Claude session; permission flag (if any)
  // follows so it applies to the resumed run too.
  const args = [];
  if (opts.resume) args.push('--resume', opts.resume);
  if (opts.bypass) args.push('--dangerously-skip-permissions');

  let term;
  try {
    term = pty.spawn(shell, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd,
      env: { ...process.env, CC_PORT: String(serverPort), CC_AGENT_ID: id },
    });
  } catch (err) {
    // cwd gone (e.g. a removed worktree) or claude not found — report as an
    // immediate exit so the renderer can surface it rather than hang.
    mainWindow?.webContents.send('agent:exit', { id, error: String(err.message || err) });
    return;
  }

  term.onData((data) => mainWindow?.webContents.send('agent:data', { id, data }));
  term.onExit(() => {
    agents.delete(id);
    mainWindow?.webContents.send('agent:exit', { id });
  });

  agents.set(id, term);
}

// Kill the agent and its child processes. claude spawns children that keep a
// handle on the worktree cwd; on Windows only a tree kill releases the lock.
function killAgent(id) {
  const term = agents.get(id);
  if (!term) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/F', '/T', '/PID', String(term.pid)], () => {});
  }
  try {
    term.kill();
  } catch {
    /* already exiting */
  }
}

// Force-remove a directory, retrying briefly while handles are released.
async function rmDirRetry(target) {
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      /* locked; retry */
    }
    if (!fs.existsSync(target)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('projects:list', () =>
    loadProjects().map((p) => ({ ...p, isGit: isGitRepo(p.dir) }))
  );

  ipcMain.handle('projects:add', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths[0]) return loadProjects();
    const projects = loadProjects();
    const dir = filePaths[0];
    if (!projects.some((p) => p.dir === dir)) {
      projects.push({ dir, name: path.basename(dir) });
      saveProjects(projects);
    }
    return projects;
  });

  ipcMain.handle('projects:remove', (_e, dir) => {
    const projects = loadProjects().filter((p) => p.dir !== dir);
    saveProjects(projects);
    return projects;
  });

  ipcMain.handle('projects:worktrees', (_e, dir) => listWorktrees(dir));

  // Branches with a flag for whether they already occupy a worktree.
  ipcMain.handle('branches:list', async (_e, dir) => {
    const [branches, worktrees] = await Promise.all([listBranches(dir), listWorktrees(dir)]);
    const taken = new Set(worktrees.map((w) => w.branch).filter(Boolean));
    return branches.map((name) => ({ name, hasWorktree: taken.has(name) }));
  });

  // Create a worktree. `newBranch` controls whether we create the branch (-b)
  // or check out an existing one. The UI guarantees a valid choice, so no
  // fallback is needed here.
  ipcMain.handle('worktree:create', async (_e, { dir, branch, newBranch }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: `Choose parent folder for worktree "${branch}"`,
    });
    if (canceled || !filePaths[0]) return { canceled: true };

    const target = path.join(filePaths[0], branch.replace(/[/\\]/g, '-'));
    const args = newBranch ? [target, '-b', branch] : [target, branch];
    try {
      await new Promise((resolve, reject) => {
        execFile('git', ['-C', dir, 'worktree', 'add', ...args], (err, _o, stderr) =>
          err ? reject(new Error(stderr || err.message)) : resolve()
        );
      });
    } catch (err) {
      return { error: String(err.message || err).trim() };
    }
    return { path: target, branch };
  });

  ipcMain.handle('worktree:remove', async (_e, { dir, path: wtPath, force }) => {
    const args = ['-C', dir, 'worktree', 'remove'];
    if (force) args.push('--force');
    args.push(wtPath);
    try {
      await new Promise((resolve, reject) => {
        execFile('git', args, (err, _o, stderr) =>
          err ? reject(new Error(stderr || err.message)) : resolve()
        );
      });
    } catch (err) {
      return { error: String(err.message || err).trim() };
    }
    // git can unregister the worktree yet leave the directory behind if a file
    // was still locked. Force-clean the leftovers and prune the admin entry.
    await rmDirRetry(wtPath);
    await new Promise((resolve) =>
      execFile('git', ['-C', dir, 'worktree', 'prune'], () => resolve())
    );
    return { ok: true };
  });

  ipcMain.handle('agent:spawn', (_e, { id, cwd, opts }) => {
    spawnAgent(id, cwd, opts);
  });

  ipcMain.on('agent:input', (_e, { id, data }) => agents.get(id)?.write(data));

  ipcMain.on('agent:resize', (_e, { id, cols, rows }) => {
    try {
      agents.get(id)?.resize(cols, rows);
    } catch {
      /* ignore resize on dead pty */
    }
  });

  ipcMain.on('agent:kill', (_e, { id }) => killAgent(id));
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: '#0e0e10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join('renderer', 'index.html'));
}

app.whenReady().then(async () => {
  registerIpc();
  await startServer();
  createWindow();
  await ensureHooksInstalled();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const term of agents.values()) term.kill();
  if (process.platform !== 'darwin') app.quit();
});
