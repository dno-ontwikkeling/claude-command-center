'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
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

// Safe IPC to the renderer. A pty can emit data after the window is closed or
// reloaded; `mainWindow?` is still truthy then but its webContents is destroyed,
// so `.send` throws "Object has been destroyed". Guard against that.
function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

const PROJECTS_FILE = path.join(app.getPath('userData'), 'projects.json');
// Workspaces: plain scratch folders (no git / worktree machinery). Launch an
// agent straight in the folder. Kept in their own store + sidebar section.
const WORKSPACES_FILE = path.join(app.getPath('userData'), 'workspaces.json');
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

function loadWorkspaces() {
  try {
    return JSON.parse(fs.readFileSync(WORKSPACES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveWorkspaces(workspaces) {
  fs.mkdirSync(path.dirname(WORKSPACES_FILE), { recursive: true });
  fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(workspaces, null, 2));
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

// ---------------------------------------------------------------------------
// Project type detection (for the sidebar icon) — cheap, one readdir per call
// ---------------------------------------------------------------------------

// Directories never worth scanning for project markers — heavy and/or noise.
const PTYPE_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.vs',
  '.idea',
  '.vscode',
  'bin',
  'obj',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.next',
  '.nuxt',
]);

// Walk up to `maxDepth` levels collecting which language markers exist, then
// pick a type by priority. Recursive so a .sln (or any marker) in a subfolder
// is still found, but depth-limited and skips heavy dirs to stay cheap.
function detectProjectType(dir, maxDepth = 3) {
  const found = { dotnet: false, node: false, go: false, rust: false, python: false };

  const scan = (d, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return; // unreadable dir
    }
    for (const e of entries) {
      if (e.isFile()) {
        const n = e.name.toLowerCase();
        if (n.endsWith('.sln') || n.endsWith('.csproj') || n.endsWith('.fsproj')) found.dotnet = true;
        else if (n === 'package.json') found.node = true;
        else if (n === 'go.mod') found.go = true;
        else if (n === 'cargo.toml') found.rust = true;
        else if (n === 'pyproject.toml' || n === 'requirements.txt' || n === 'setup.py' || n === 'pipfile')
          found.python = true;
      } else if (e.isDirectory() && depth < maxDepth && !PTYPE_SKIP_DIRS.has(e.name)) {
        scan(path.join(d, e.name), depth + 1);
      }
    }
  };

  scan(dir, 0);
  // Priority: a .NET solution outranks an incidental package.json (tooling).
  return (
    (found.dotnet && 'dotnet') ||
    (found.node && 'node') ||
    (found.go && 'go') ||
    (found.rust && 'rust') ||
    (found.python && 'python') ||
    null
  );
}

// Per-worktree git state: dirty file count and ahead/behind vs upstream.
function worktreeStatus(wtPath) {
  return new Promise((resolve) => {
    execFile('git', ['-C', wtPath, 'status', '--porcelain=v1', '--branch'], (err, stdout) => {
      if (err) {
        resolve({ dirty: 0, ahead: 0, behind: 0, upstream: null });
        return;
      }
      const lines = stdout.split(/\r?\n/);
      const head = lines[0] || ''; // "## main...origin/main [ahead 1, behind 2]"
      const up = head.match(/\.\.\.(\S+)/);
      const ahead = head.match(/ahead (\d+)/);
      const behind = head.match(/behind (\d+)/);
      const dirty = lines.slice(1).filter(Boolean).length;
      resolve({
        dirty,
        ahead: ahead ? +ahead[1] : 0,
        behind: behind ? +behind[1] : 0,
        upstream: up ? up[1] : null,
      });
    });
  });
}

// List all worktrees of a repo, each enriched with its dirty/ahead/behind state.
async function listWorktrees(dir) {
  const worktrees = await new Promise((resolve) => {
    execFile('git', ['-C', dir, 'worktree', 'list', '--porcelain'], (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }
      const out = [];
      let cur = null;
      for (const line of stdout.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
          cur = { path: line.slice(9), branch: null };
          out.push(cur);
        } else if (line.startsWith('branch ') && cur) {
          cur.branch = line.slice(7).replace('refs/heads/', '');
        }
      }
      // git lists the main working tree first; it cannot be removed.
      if (out.length) out[0].isMain = true;
      resolve(out);
    });
  });
  await Promise.all(worktrees.map(async (w) => Object.assign(w, await worktreeStatus(w.path))));
  return worktrees;
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

// Remote-tracking branches (origin/*), minus the symbolic origin/HEAD pointer.
function listRemoteBranches(dir) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'branch', '-r', '--format=%(refname:short)'], (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          // keep "remote/branch", drop the symbolic "origin" (origin/HEAD short form)
          .filter((n) => n.includes('/') && !n.endsWith('/HEAD'))
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
      'Adds lifecycle hooks so worktrees launched from Command Center report their ' +
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
          sendToRenderer('agent:event', event);
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
    sendToRenderer('agent:exit', { id, error: String(err.message || err) });
    return;
  }

  term.onData((data) => sendToRenderer('agent:data', { id, data }));
  term.onExit(({ exitCode } = {}) => {
    agents.delete(id);
    sendToRenderer('agent:exit', { id, exitCode });
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
  const enrich = (p) => ({ ...p, isGit: isGitRepo(p.dir), type: detectProjectType(p.dir) });

  ipcMain.handle('projects:list', () => loadProjects().map(enrich));

  // Persist a new project order (array of dirs from the sidebar drag-reorder).
  // Any project missing from the list is appended, so a stale list never drops
  // a project.
  ipcMain.handle('projects:reorder', (_e, dirs) => {
    const projects = loadProjects();
    const byDir = new Map(projects.map((p) => [p.dir, p]));
    const ordered = dirs.map((d) => byDir.get(d)).filter(Boolean);
    for (const p of projects) if (!dirs.includes(p.dir)) ordered.push(p);
    saveProjects(ordered);
    return ordered.map(enrich);
  });

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

  // -- Workspaces: scratch folders, no git required --------------------------

  ipcMain.handle('workspaces:list', () => loadWorkspaces().map(enrich));

  // Create a workspace: ask where (parent folder picker), make `parent/name`,
  // register it. Returns the enriched record, or { canceled }/{ error }.
  ipcMain.handle('workspaces:create', async (_e, name) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: `Choose parent folder for workspace "${name}"`,
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    const dir = path.join(filePaths[0], name.replace(/[/\\]/g, '-'));
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      return { error: String(err.message || err).trim() };
    }
    const list = loadWorkspaces();
    if (!list.some((w) => w.dir === dir)) {
      list.push({ dir, name });
      saveWorkspaces(list);
    }
    return enrich({ dir, name });
  });

  ipcMain.handle('workspaces:remove', (_e, dir) => {
    const list = loadWorkspaces().filter((w) => w.dir !== dir);
    saveWorkspaces(list);
    return list.map(enrich);
  });

  ipcMain.handle('workspaces:reorder', (_e, dirs) => {
    const list = loadWorkspaces();
    const byDir = new Map(list.map((w) => [w.dir, w]));
    const ordered = dirs.map((d) => byDir.get(d)).filter(Boolean);
    for (const w of list) if (!dirs.includes(w.dir)) ordered.push(w);
    saveWorkspaces(ordered);
    return ordered.map(enrich);
  });

  ipcMain.handle('projects:worktrees', (_e, dir) => listWorktrees(dir));

  // Local + remote branches, each flagged for whether it already has a worktree
  // (local) or a matching local branch (remote). Plus the repo's current branch.
  ipcMain.handle('branches:list', async (_e, dir) => {
    const [local, remote, worktrees] = await Promise.all([
      listBranches(dir),
      listRemoteBranches(dir),
      listWorktrees(dir),
    ]);
    const taken = new Set(worktrees.map((w) => w.branch).filter(Boolean));
    const localSet = new Set(local);
    return {
      current: gitBranch(dir),
      local: local.map((name) => ({ name, hasWorktree: taken.has(name) })),
      remote: remote.map((name) => ({
        name,
        hasLocal: localSet.has(name.split('/').slice(1).join('/')),
      })),
    };
  });

  // Create a worktree. `mode` selects the source:
  //   new    -> create branch `branch`, optionally forked from `base`
  //   local  -> check out an existing local branch
  //   remote -> create a local tracking branch from a remote ref (origin/x -> x)
  ipcMain.handle('worktree:create', async (_e, { dir, mode, branch, base }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: `Choose parent folder for worktree "${branch}"`,
    });
    if (canceled || !filePaths[0]) return { canceled: true };

    let display = branch;
    let args;
    let target;
    if (mode === 'remote') {
      const localName = branch.split('/').slice(1).join('/') || branch;
      target = path.join(filePaths[0], localName.replace(/[/\\]/g, '-'));
      args = [target, '-b', localName, branch]; // tracks the remote ref
      display = localName;
    } else if (mode === 'new') {
      target = path.join(filePaths[0], branch.replace(/[/\\]/g, '-'));
      args = [target, '-b', branch, ...(base ? [base] : [])];
    } else {
      target = path.join(filePaths[0], branch.replace(/[/\\]/g, '-'));
      args = [target, branch];
    }
    try {
      await new Promise((resolve, reject) => {
        execFile('git', ['-C', dir, 'worktree', 'add', ...args], (err, _o, stderr) =>
          err ? reject(new Error(stderr || err.message)) : resolve()
        );
      });
    } catch (err) {
      return { error: String(err.message || err).trim() };
    }
    return { path: target, branch: display };
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

  // Git fetch / pull for the active worktree. pull is --ff-only so a button
  // press can never spawn a merge commit or drop the user into a conflict.
  ipcMain.handle('git:fetch', (_e, cwd) => runGit(cwd, ['fetch', '--prune']));
  ipcMain.handle('git:pull', (_e, cwd) => runGit(cwd, ['pull', '--ff-only']));
  // Force-delete a local branch (used after its worktree is removed).
  ipcMain.handle('git:delete-branch', (_e, { dir, branch }) => runGit(dir, ['branch', '-D', branch]));

  // Current branch for a worktree (reads .git/HEAD). Lets the sidebar refresh a
  // stale label after the user switches branch inside the worktree's terminal.
  ipcMain.handle('git:branch', (_e, cwd) => gitBranch(cwd));

  // Open a terminal link in the user's default browser. Only http(s) — never
  // hand arbitrary schemes (file:, javascript:) to the OS shell.
  ipcMain.handle('open-external', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // Open a worktree in Visual Studio. Prefers a top-level .sln; otherwise opens
  // the folder ("Open Folder" mode). Returns an error string the UI can surface.
  ipcMain.handle('vs:open', (_e, cwd) => openInVisualStudio(cwd));

  // Reveal a worktree in the OS file manager (Explorer / Finder / Files).
  ipcMain.handle('explorer:open', async (_e, cwd) => {
    const err = await shell.openPath(cwd); // returns '' on success
    return err ? { error: err } : { ok: true };
  });

  // Added + removed line counts for a worktree vs HEAD (staged + unstaged),
  // shown as a "+N/-M" badge in the sidebar.
  ipcMain.handle('git:diffstat', (_e, cwd) => {
    return new Promise((resolve) => {
      execFile('git', ['-C', cwd, 'diff', '--numstat', 'HEAD'], (err, stdout) => {
        if (err) {
          resolve({ added: 0, removed: 0 });
          return;
        }
        let added = 0;
        let removed = 0;
        for (const line of stdout.split(/\r?\n/)) {
          const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
          if (m) {
            if (m[1] !== '-') added += +m[1];
            if (m[2] !== '-') removed += +m[2];
          }
        }
        resolve({ added, removed });
      });
    });
  });
}

// Locate devenv.exe via vswhere (ships with every VS 2017+ installer). Returns
// null when neither vswhere nor a VS install is present.
function resolveDevenv() {
  return new Promise((resolve) => {
    const pf = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || 'C:\\Program Files (x86)';
    const vswhere = path.join(pf, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!fs.existsSync(vswhere)) {
      resolve(null);
      return;
    }
    execFile(
      vswhere,
      ['-latest', '-prerelease', '-property', 'productPath'],
      (err, stdout) => {
        const p = (stdout || '').trim();
        resolve(!err && p && fs.existsSync(p) ? p : null);
      }
    );
  });
}

// Open a worktree in Visual Studio. Prefer a top-level .sln (single match opens
// directly; multiple -> open the folder so the user picks). Windows only.
async function openInVisualStudio(cwd) {
  if (process.platform !== 'win32') {
    return { error: 'Visual Studio is only available on Windows.' };
  }
  const devenv = await resolveDevenv();
  if (!devenv) {
    return { error: 'Visual Studio not found (vswhere reported no install).' };
  }
  let target = cwd;
  try {
    const slns = fs.readdirSync(cwd).filter((f) => f.toLowerCase().endsWith('.sln'));
    if (slns.length === 1) target = path.join(cwd, slns[0]);
  } catch {
    /* unreadable dir — fall back to opening cwd */
  }
  return new Promise((resolve) => {
    // detached so VS outlives this app; unref so we don't hold the child.
    const child = execFile(devenv, [target], (err) => {
      if (err) resolve({ error: String(err.message || err).trim() });
    });
    child.on('spawn', () => resolve({ ok: true }));
    child.on('error', (err) => resolve({ error: String(err.message || err).trim() }));
    child.unref();
  });
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`.trim();
      resolve({ ok: !err, out, error: err ? out || String(err.message) : null });
    });
  });
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
  Menu.setApplicationMenu(null); // no File/Edit/View/Window/Help bar
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
