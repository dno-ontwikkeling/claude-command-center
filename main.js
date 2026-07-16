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
// Safe JSON IO (crash/corruption resistant)
// ---------------------------------------------------------------------------

// Copy a bad/unreadable file aside so it is never silently lost when we later
// refuse to overwrite it. Returns the backup path, or null if even the copy
// failed. Best-effort: a failed backup must not mask the original error.
function backupBadFile(file) {
  try {
    const bak = `${file}.bak-${Date.now()}`;
    fs.copyFileSync(file, bak);
    return bak;
  } catch {
    return null;
  }
}

// Read + parse JSON, distinguishing "file does not exist yet" (genuine first
// run -> return `fallback`) from a corrupt/truncated/permission-failed read. In
// the latter case we must NOT return the fallback: a caller would then save()
// over the file and permanently destroy recoverable data. Instead back up the
// bad file and throw so the caller aborts before any write.
function readJsonSafe(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    const bak = backupBadFile(file);
    throw new Error(
      `Could not read ${file}: ${err.message}${bak ? ` (backed up to ${bak})` : ''}`
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const bak = backupBadFile(file);
    throw new Error(
      `Could not parse ${file}: ${err.message}${bak ? ` (backed up to ${bak})` : ''}`
    );
  }
}

// Write JSON atomically: serialize to a temp file in the same directory, then
// rename over the target. rename is atomic on the same filesystem, so a crash
// or power loss mid-write can never leave a truncated live file (which the
// readers above would otherwise treat as corrupt).
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Project persistence
// ---------------------------------------------------------------------------

function loadProjects() {
  try {
    return readJsonSafe(PROJECTS_FILE, []);
  } catch (err) {
    // Corrupt/unreadable store (already backed up). Surface before any caller
    // can save() over it, then re-throw so the mutation is aborted — never
    // return [] here, that is exactly the data-loss path we are fixing.
    dialog.showErrorBox('Command Center — projects.json unreadable', String(err.message || err));
    throw err;
  }
}

function saveProjects(projects) {
  writeJsonAtomic(PROJECTS_FILE, projects);
}

function loadWorkspaces() {
  try {
    return readJsonSafe(WORKSPACES_FILE, []);
  } catch (err) {
    dialog.showErrorBox('Command Center — workspaces.json unreadable', String(err.message || err));
    throw err;
  }
}

function saveWorkspaces(workspaces) {
  writeJsonAtomic(WORKSPACES_FILE, workspaces);
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
      } else if (e.isDirectory() && depth < maxDepth && !PTYPE_SKIP_DIRS.has(e.name.toLowerCase())) {
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

// A project's type never changes for a given dir while the app runs, yet the
// scan above is a synchronous depth-3 recursion that blocks the event loop
// (which also pumps PTY onData/onExit). Cache the result per dir so the
// projects:list / workspaces:list handlers — including the 15s auto-refresh —
// don't re-walk the tree every call. The add/remove handlers invalidate the
// entry so a re-added dir is re-scanned.
const projectTypeCache = new Map();

function detectProjectTypeCached(dir) {
  if (projectTypeCache.has(dir)) return projectTypeCache.get(dir);
  const type = detectProjectType(dir);
  projectTypeCache.set(dir, type);
  return type;
}

function invalidateProjectType(dir) {
  projectTypeCache.delete(dir);
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

// Resolve the branch a feature worktree should be diffed against. Prefers the
// remote's default branch (origin/HEAD -> e.g. origin/main), falling back to a
// local main / master. Returns null when none of those exist.
function resolveDiffBase(dir) {
  const verify = (ref) =>
    new Promise((resolve) => {
      execFile('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', ref], (err) =>
        resolve(!err)
      );
    });
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], async (err, stdout) => {
      const ref = (stdout || '').trim();
      if (!err && ref) {
        resolve(ref);
        return;
      }
      for (const cand of ['origin/main', 'origin/master', 'main', 'master']) {
        if (await verify(cand)) {
          resolve(cand);
          return;
        }
      }
      resolve(null);
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

// Shell / command metacharacters that must never end up in a folder name: the
// name is later baked into a filesystem path that gets handed to launchers
// (VS Code, git). Rejecting them at creation time is defence-in-depth on top of
// launching with shell:false. (`/` and `\` are handled separately by callers,
// which normalise them to `-`.)
const SHELL_META = /[&|;<>()!^%$"'`\n\r]/;
function hasShellMeta(name) {
  return SHELL_META.test(String(name));
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
  // This file is the shared CLI config — NOT owned by this app. Distinguish a
  // missing file (first run, fine to create) from a parse/IO failure. On a
  // parse failure readJsonSafe backs it up and throws; we must then bail out
  // rather than default settings to {} and write it back, which would wipe the
  // user's permissions / model prefs / other hooks.
  let settings;
  try {
    settings = readJsonSafe(file, null); // null sentinel = missing (first run)
  } catch (err) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Command Center setup',
      message: 'Could not read ~/.claude/settings.json',
      detail:
        `${err.message}\n\n` +
        'A backup was saved alongside it. Status hooks were NOT installed, to ' +
        'avoid overwriting your existing settings. Fix or restore the file and ' +
        'restart to try again.',
    });
    return;
  }
  if (settings === null) settings = {}; // genuine first run — safe to create

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

  // Merge the hooks block in place so every pre-existing key on `settings`
  // (permissions, model prefs, unrelated hooks) is preserved.
  settings.hooks = settings.hooks || {};
  for (const [event, status] of Object.entries(HOOK_EVENTS)) {
    const command = `node "${REPORT_SCRIPT}" ${status}`;
    settings.hooks[event] = settings.hooks[event] || [];
    settings.hooks[event].push({ hooks: [{ type: 'command', command }] });
  }

  writeJsonAtomic(file, settings);
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
  const enrich = (p) => ({ ...p, isGit: isGitRepo(p.dir), type: detectProjectTypeCached(p.dir) });

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
    if (canceled || !filePaths[0]) return loadProjects().map(enrich);
    const projects = loadProjects();
    const dir = filePaths[0];
    if (!projects.some((p) => p.dir === dir)) {
      invalidateProjectType(dir); // re-scan a (possibly re-added) dir fresh
      projects.push({ dir, name: path.basename(dir) });
      saveProjects(projects);
    }
    // Return enriched (isGit/type) so the sidebar keeps its icons immediately,
    // rather than dropping them until the next 15s poll — parity with
    // projects:list / :reorder / the workspace handlers.
    return projects.map(enrich);
  });

  ipcMain.handle('projects:remove', (_e, dir) => {
    const projects = loadProjects().filter((p) => p.dir !== dir);
    invalidateProjectType(dir);
    saveProjects(projects);
    return projects.map(enrich);
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
    if (hasShellMeta(name)) {
      return { error: 'Workspace name contains unsafe characters (& | ; < > ( ) ! ^ % $ " \' `).' };
    }
    const dir = path.join(filePaths[0], name.replace(/[/\\]/g, '-'));
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      return { error: String(err.message || err).trim() };
    }
    const list = loadWorkspaces();
    if (!list.some((w) => w.dir === dir)) {
      invalidateProjectType(dir); // fresh dir — drop any stale cached type
      list.push({ dir, name });
      saveWorkspaces(list);
    }
    return enrich({ dir, name });
  });

  ipcMain.handle('workspaces:remove', (_e, dir) => {
    const list = loadWorkspaces().filter((w) => w.dir !== dir);
    invalidateProjectType(dir);
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
    if (hasShellMeta(branch)) {
      return { error: 'Branch name contains unsafe characters (& | ; < > ( ) ! ^ % $ " \' `).' };
    }

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

  ipcMain.on('agent:input', (_e, { id, data }) => {
    try {
      agents.get(id)?.write(data);
    } catch {
      /* ignore input to a dead pty (write can throw in the keystroke/onExit race) */
    }
  });

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

  // Open a worktree in VS Code via the `code` CLI (on PATH after install).
  ipcMain.handle('code:open', (_e, cwd) => openInVSCode(cwd));

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

  // Full unified diff for the diff viewer. `mode`:
  //   wip    -> uncommitted working tree vs HEAD (staged + unstaged)
  //   branch -> this branch vs its base (origin/main …), i.e. the PR-style diff
  // Returns { ok, diff, base? } or { ok:false, error }. maxBuffer is bumped so a
  // large diff isn't truncated into a spawn error.
  ipcMain.handle('git:diff', async (_e, { cwd, mode }) => {
    const run = (args) =>
      new Promise((resolve) => {
        execFile('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
          resolve({ err, stdout: stdout || '', stderr: (stderr || '').trim() })
        );
      });

    if (mode === 'branch') {
      const base = await resolveDiffBase(cwd);
      if (!base) return { ok: false, error: 'No base branch (origin/main, main, master…) found.' };
      const r = await run(['diff', `${base}...HEAD`]);
      if (r.err) return { ok: false, error: r.stderr || String(r.err.message) };
      return { ok: true, diff: r.stdout, base };
    }

    const r = await run(['diff', 'HEAD']);
    if (r.err) return { ok: false, error: r.stderr || String(r.err.message) };
    return { ok: true, diff: r.stdout };
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

// Resolve the `code` CLI's real path once and cache it. Never route the launch
// through a shell (the old shell:true fed a git-branch-derived path to cmd.exe,
// allowing command injection via metacharacters in a hostile branch name).
//   undefined = not resolved yet, null = looked up but not found, string = path.
let vscodeCliPath;

function resolveVSCode() {
  return new Promise((resolve) => {
    if (vscodeCliPath !== undefined) {
      resolve(vscodeCliPath);
      return;
    }
    const finder = process.platform === 'win32' ? 'where' : 'which';
    execFile(finder, ['code'], { windowsHide: true }, (err, stdout) => {
      const first = (stdout || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)[0];
      vscodeCliPath = !err && first ? first : null;
      resolve(vscodeCliPath);
    });
  });
}

// Open a worktree in VS Code via the resolved `code` CLI. On Windows `code` is
// the code.cmd shim; a .cmd cannot be spawned without a shell, so we run it via
// the comspec with cwd as a separate argv element — never a concatenated shell
// string — so path metacharacters stay inert. It launches the editor and exits,
// so we resolve on the callback. Missing CLI surfaces as an error string.
async function openInVSCode(cwd) {
  const code = await resolveVSCode();
  if (!code) {
    return {
      error:
        "VS Code CLI (`code`) not found on PATH. In VS Code run: Shell Command: Install 'code' command in PATH.",
    };
  }
  const isWin = process.platform === 'win32';
  const file = isWin ? process.env.ComSpec || 'cmd.exe' : code;
  const args = isWin ? ['/d', '/s', '/c', code, cwd] : [cwd];
  return new Promise((resolve) => {
    execFile(file, args, { shell: false, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        resolve({ error: (stderr || '').trim() || String(err.message || err).trim() });
      } else {
        resolve({ ok: true });
      }
    });
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

// Single-instance lock. A second launch would race the first on the JSON
// stores (projects.json / workspaces.json), so bail out early and hand focus
// back to the window that already owns them.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
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
