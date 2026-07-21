'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const pty = require('@lydell/node-pty');
const log = require('./logger');
const { errMsg } = require('./util');
const hookAuth = require('./hookauth');
const hooksMerge = require('./hooksmerge');
const { createRequestHandler } = require('./hookserver');
const { openInVisualStudio, openInVSCode } = require('./editors');
const { readJsonSafe, writeJsonAtomic, hasShellMeta, hasLeadingDash } = require('./jsonstore');
const { gitBranch, isGitRepo, detectProjectType } = require('./gitinfo');
const {
  execGit,
  runGit,
  worktreeStatus,
  listWorktrees,
  listBranches,
  listRemoteBranches,
  resolveDiffBase,
} = require('./gitops');

// Last-resort handlers so a stray throw/rejection is recorded instead of dying
// silently (or crashing the whole process with no trace).
process.on('uncaughtException', (err) => log.error('uncaughtException', err));
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Map<string, import('@lydell/node-pty').IPty>} */
const agents = new Map();
let mainWindow = null;
let serverPort = 0;
// Per-run master secret. Never handed out directly; each agent gets its OWN
// token = HMAC(agentId, master), injected as CC_SECRET. A spawned agent can read
// its own token but can't compute another agent's (that needs the master), so it
// can't forge events for a different agentId — closing agent-to-agent spoofing.
const HOOK_SECRET = crypto.randomBytes(32).toString('hex');
const agentSecret = (id) => hookAuth.agentSecret(HOOK_SECRET, id);

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
// Sourced from hookauth.js so eventHasReport's install-detection always
// matches the exact path this app installs, never a duplicated computation
// that could drift out of sync.
const REPORT_SCRIPT = hookAuth.REPORT_SCRIPT;

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
// Safe JSON IO (crash/corruption resistant) — readJsonSafe / writeJsonAtomic /
// hasShellMeta live in ./jsonstore.js (electron-free so they can be unit tested).
// ---------------------------------------------------------------------------

// A corrupt store re-throws on every load; loaders run on a 15s poll, so surface
// the blocking dialog only once per file per session (the backup is de-duped in
// backupBadFile). Returns true the first time a given file is reported.
const corruptWarned = new Set();
function warnCorruptOnce(file, title, message) {
  if (corruptWarned.has(file)) return;
  corruptWarned.add(file);
  dialog.showErrorBox(title, message);
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
    warnCorruptOnce('projects', 'Command Center — projects.json unreadable', errMsg(err));
    throw err;
  }
}

// Persist a store, surfacing write failures instead of letting them become a
// silent unhandled rejection in the renderer (the live file stays intact — the
// atomic write leaves it untouched on failure — but the change wasn't saved, so
// tell the user rather than showing unpersisted state as if it stuck).
function persistStore(file, data, label) {
  try {
    writeJsonAtomic(file, data);
  } catch (err) {
    log.error('persistence', `could not save ${label}`, err);
    dialog.showErrorBox(`Command Center — could not save ${label}`, errMsg(err));
    throw err;
  }
}

function saveProjects(projects) {
  persistStore(PROJECTS_FILE, projects, 'projects');
}

function loadWorkspaces() {
  try {
    return readJsonSafe(WORKSPACES_FILE, []);
  } catch (err) {
    warnCorruptOnce('workspaces', 'Command Center — workspaces.json unreadable', errMsg(err));
    throw err;
  }
}

function saveWorkspaces(workspaces) {
  persistStore(WORKSPACES_FILE, workspaces, 'workspaces');
}

// ---------------------------------------------------------------------------
// Known-directory validation (SEC-2) — IPC handlers below take a renderer-
// supplied dir/cwd (git ops, editor/explorer opens, worktree ops). A
// compromised/buggy renderer could otherwise point them at an arbitrary path.
// "Known" means: a registered project root, a registered workspace root, or a
// dir this process has itself spawned a live agent into (a worktree or
// workspace path — see spawnAgent below). The latter is populated at
// agent:spawn time, which always happens (from the real UI flows) before any
// subsequent git/editor IPC call could reference that same cwd — including a
// freshly created worktree, since the renderer spawns an agent into it
// immediately after worktree:create resolves. Entries are intentionally never
// removed on pty exit: deleteWorktree() kills the agent (releasing its cwd's
// file lock) BEFORE calling worktree:remove, so clearing on exit would reject
// that very removal call.
const knownAgentDirs = new Set(); // normalized dirs

function normPath(p) {
  const resolved = path.resolve(String(p));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function rememberAgentDir(dir) {
  try {
    knownAgentDirs.add(normPath(dir));
  } catch {
    /* not a usable path — nothing to remember */
  }
}

function isKnownDir(dir) {
  if (typeof dir !== 'string' || !dir) return false;
  let target;
  try {
    target = normPath(dir);
  } catch {
    return false;
  }
  try {
    if (loadProjects().some((p) => normPath(p.dir) === target)) return true;
    if (loadWorkspaces().some((w) => normPath(w.dir) === target)) return true;
  } catch {
    // Corrupt store: already surfaced via warnCorruptOnce elsewhere. Fall
    // through to the agent-dir check rather than throwing from inside a
    // validation helper.
  }
  return knownAgentDirs.has(target);
}

// ---------------------------------------------------------------------------
// Project type detection cache — gitBranch/isGitRepo/detectProjectType live in
// ./gitinfo.js (electron-free, unit tested). detectProjectType is a synchronous
// depth-3 recursion that blocks the event loop (which also pumps PTY onData/
// onExit), yet a dir's type never changes while the app runs. Cache per dir so
// the projects:list / workspaces:list handlers — including the 15s auto-refresh
// — don't re-walk the tree every call; add/remove handlers invalidate the entry
// so a re-added dir is re-scanned.
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

// hooksInstalled/mergeHooksInto/loadSettings live in ./hooksmerge.js (electron-
// free so the merge — and the corrupt-settings abort path below — can be unit
// tested; see test/hooksmerge.test.js).
async function ensureHooksInstalled() {
  const file = settingsPath();
  // This file is the shared CLI config — NOT owned by this app. loadSettings
  // distinguishes a missing file (first run, fine to create) from a parse/IO
  // failure. On a parse failure we must bail out rather than default settings
  // to {} and write it back, which would wipe the user's permissions / model
  // prefs / other hooks.
  const loaded = hooksMerge.loadSettings(file);
  if (!loaded.ok) {
    const err = loaded.error;
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
  const settings = loaded.settings; // genuine first run already normalized to {}

  if (hooksMerge.hooksInstalled(settings, HOOK_EVENTS, REPORT_SCRIPT)) return;

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
  hooksMerge.mergeHooksInto(settings, HOOK_EVENTS, REPORT_SCRIPT);

  writeJsonAtomic(file, settings);
}

// ---------------------------------------------------------------------------
// Local HTTP server — receives hook events, forwards to renderer
// ---------------------------------------------------------------------------

function startServer() {
  return new Promise((resolve) => {
    // Request handling itself lives in ./hookserver.js (electron-free — the
    // agents map, per-agent secret and renderer sink are injected — so it can
    // be integration tested against a real http server; see
    // test/hookserver.test.js). Only the actual http.Server + listen() stay
    // here since serverPort/agents are main.js state.
    const server = http.createServer(
      createRequestHandler({ agents, agentSecret, sendToRenderer, log })
    );
    // A connection that opens and never sends (or sends a partial request and
    // stalls) would otherwise hang its socket forever. 5s is generous for a
    // localhost loopback hook payload; setTimeout emits 'timeout' on the
    // socket, whose default handler (none set here) just destroys it.
    server.setTimeout(5000);
    // An unhandled server 'error' event is fatal — same rationale as the
    // per-request 'error' listener inside the handler.
    server.on('error', (err) => log.error('hook-server', 'server error', err));
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
  // Record the cwd as known BEFORE the actual spawn (even a failed spawn's
  // cwd was legitimately requested through the agent lifecycle, not just any
  // renderer-supplied string reaching a git/editor handler directly).
  rememberAgentDir(cwd);
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
      env: { ...process.env, CC_PORT: String(serverPort), CC_AGENT_ID: id, CC_SECRET: agentSecret(id) },
    });
  } catch (err) {
    // cwd gone (e.g. a removed worktree) or claude not found — report as an
    // immediate exit so the renderer can surface it rather than hang.
    sendToRenderer('agent:exit', { id, error: errMsg(err) });
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
    execFile('taskkill', ['/F', '/T', '/PID', String(term.pid)], (err) => {
      if (err) log.warn('pty', `taskkill failed for agent ${id} (pid ${term.pid})`, err);
    });
  }
  try {
    term.kill();
  } catch {
    /* already exiting */
  }
}

// Force-remove a directory, retrying briefly while handles are released.
// Returns true once the directory is gone, false if it still exists after all
// retries (e.g. a process is still holding a lock) so callers can report the
// incomplete cleanup instead of assuming success.
async function rmDirRetry(target) {
  for (let i = 0; i < 5; i++) {
    try {
      await fs.promises.rm(target, { recursive: true, force: true });
    } catch {
      /* locked; retry */
    }
    if (!fs.existsSync(target)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return !fs.existsSync(target);
}

// ---------------------------------------------------------------------------
// Git change watchers — push a 'git:changed' to the renderer when a watched
// repo's .git changes (branch switch, commit, staging), so the sidebar updates
// promptly instead of only on the next poll. Best-effort and purely additive:
// the renderer keeps a foreground poll as the correctness floor, so a missed or
// unsupported fs.watch event just falls back to the slower refresh.
// ---------------------------------------------------------------------------

const gitWatchers = new Map(); // dir -> FSWatcher
let gitChangeTimer = null;
// Dirs that fired since the last flush. `null` means "unknown/mixed" — a caller
// passed no dir, or more than one distinct dir changed inside the same debounce
// window — so the renderer should fall back to a full refresh instead of
// guessing which one to scope to.
let pendingGitDirs = new Set();
let pendingGitDirsUnknown = false;

function scheduleGitChanged(dir) {
  // git touches several files per operation; coalesce into one notification.
  if (dir) pendingGitDirs.add(dir);
  else pendingGitDirsUnknown = true;
  clearTimeout(gitChangeTimer);
  gitChangeTimer = setTimeout(() => {
    const changedDir =
      !pendingGitDirsUnknown && pendingGitDirs.size === 1 ? [...pendingGitDirs][0] : null;
    pendingGitDirs = new Set();
    pendingGitDirsUnknown = false;
    sendToRenderer('git:changed', { dir: changedDir });
  }, 400);
}

function watchGitDirs(dirs) {
  const wanted = new Set(Array.isArray(dirs) ? dirs : []);
  for (const [dir, w] of gitWatchers) {
    if (wanted.has(dir)) continue;
    try {
      w.close();
    } catch {
      /* already closed */
    }
    gitWatchers.delete(dir);
  }
  for (const dir of wanted) {
    if (gitWatchers.has(dir)) continue;
    try {
      const w = fs.watch(path.join(dir, '.git'), { persistent: false }, () => scheduleGitChanged(dir));
      w.on('error', () => {
        try {
          w.close();
        } catch {
          /* noop */
        }
        gitWatchers.delete(dir);
      });
      gitWatchers.set(dir, w);
    } catch {
      // No .git, or fs.watch unsupported for this path — the poll floor covers it.
    }
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.on('watch:set', (_e, dirs) => watchGitDirs(dirs));

  const enrich = (p) => ({ ...p, isGit: isGitRepo(p.dir), type: detectProjectTypeCached(p.dir) });

  // Renderer-forwarded log lines land in the same file as main-process logs.
  const rendererLog = log.make('renderer');
  ipcMain.on('log', (_e, { level, args }) => {
    const fn = rendererLog[level] || rendererLog.info;
    fn(...(Array.isArray(args) ? args : [args]));
  });

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
    if (!projects.some((p) => normPath(p.dir) === normPath(dir))) {
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
      return { error: errMsg(err).trim() };
    }
    const list = loadWorkspaces();
    if (!list.some((w) => normPath(w.dir) === normPath(dir))) {
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

  ipcMain.handle('projects:worktrees', (_e, dir) => (isKnownDir(dir) ? listWorktrees(dir) : []));

  // Local + remote branches, each flagged for whether it already has a worktree
  // (local) or a matching local branch (remote). Plus the repo's current branch.
  ipcMain.handle('branches:list', async (_e, dir) => {
    if (!isKnownDir(dir)) return { current: null, local: [], remote: [] };
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
    if (!isKnownDir(dir)) return { error: 'Unknown project directory.' };
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: `Choose parent folder for worktree "${branch}"`,
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    if (hasShellMeta(branch)) {
      return { error: 'Branch name contains unsafe characters (& | ; < > ( ) ! ^ % $ " \' `).' };
    }
    // A ref/branch name starting with '-' is indistinguishable from a git
    // option once it hits argv — reject it up front rather than relying on
    // the `--` separator below alone (see hasLeadingDash in jsonstore.js for
    // why `--` isn't sufficient on its own for `-b <name>`).
    if (hasLeadingDash(branch) || hasLeadingDash(base)) {
      return { error: 'Branch name cannot start with "-".' };
    }

    let display = branch;
    let args;
    let target;
    if (mode === 'remote') {
      const localName = branch.split('/').slice(1).join('/') || branch;
      if (hasLeadingDash(localName)) {
        return { error: 'Branch name cannot start with "-".' };
      }
      target = path.join(filePaths[0], localName.replace(/[/\\]/g, '-'));
      // `--` ends option parsing before the positional path/commit-ish args.
      args = ['-b', localName, '--', target, branch]; // tracks the remote ref
      display = localName;
    } else if (mode === 'new') {
      target = path.join(filePaths[0], branch.replace(/[/\\]/g, '-'));
      args = ['-b', branch, '--', target, ...(base ? [base] : [])];
    } else {
      target = path.join(filePaths[0], branch.replace(/[/\\]/g, '-'));
      args = ['--', target, branch];
    }
    try {
      const r = await execGit(dir, ['worktree', 'add', ...args]);
      if (!r.ok) throw new Error(r.stderr || r.error.message);
    } catch (err) {
      return { error: errMsg(err).trim() };
    }
    return { path: target, branch: display };
  });

  ipcMain.handle('worktree:remove', async (_e, { dir, path: wtPath, force }) => {
    if (!isKnownDir(dir) || !isKnownDir(wtPath)) return { error: 'Unknown directory.' };
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push('--', wtPath);
    try {
      const r = await execGit(dir, args);
      if (!r.ok) throw new Error(r.stderr || r.error.message);
    } catch (err) {
      return { error: errMsg(err).trim() };
    }
    // git can unregister the worktree yet leave the directory behind if a file
    // was still locked. Force-clean the leftovers and prune the admin entry.
    const cleaned = await rmDirRetry(wtPath);
    await execGit(dir, ['worktree', 'prune']);
    // git removed the worktree registration, but if the folder itself couldn't
    // be deleted, don't claim success — surface it so the renderer can tell the
    // user the on-disk cleanup was incomplete rather than silently leaving an
    // orphan directory behind.
    if (!cleaned) {
      return {
        ok: false,
        cleanupIncomplete: true,
        error:
          'The worktree was unregistered, but its folder could not be fully ' +
          `deleted (a file may still be locked). Remove it manually:\n\n${wtPath}`,
      };
    }
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
  ipcMain.handle('git:fetch', (_e, cwd) =>
    isKnownDir(cwd) ? runGit(cwd, ['fetch', '--prune']) : { ok: false, error: 'Unknown directory.' }
  );
  ipcMain.handle('git:pull', (_e, cwd) =>
    isKnownDir(cwd) ? runGit(cwd, ['pull', '--ff-only']) : { ok: false, error: 'Unknown directory.' }
  );
  // Delete a local branch (used after its worktree is removed). Try the safe
  // `-d` first — git refuses if the branch has commits not merged into its
  // upstream/HEAD, which `-D` would orphan. Only on that refusal do we surface a
  // clear warning and, if the user confirms, escalate to the destructive `-D`.
  ipcMain.handle('git:delete-branch', async (_e, { dir, branch }) => {
    if (!isKnownDir(dir)) return { ok: false, error: 'Unknown directory.' };
    // `--` ends option parsing before the positional branch name; a leading
    // '-' in `branch` is rejected up front too (belt-and-braces, see
    // hasLeadingDash in jsonstore.js).
    if (hasLeadingDash(branch)) return { ok: false, error: 'Branch name cannot start with "-".' };
    const safe = await runGit(dir, ['branch', '-d', '--', branch]);
    if (safe.ok) return safe;
    // Anything other than the "not fully merged" refusal is a real failure the
    // user should see as-is (branch missing, still checked out elsewhere, …).
    if (!/not fully merged/i.test(safe.error || '')) return safe;

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Force delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Branch not fully merged',
      message: `Branch "${branch}" has commits that are not merged.`,
      detail:
        `${safe.error}\n\n` +
        'Force-deleting permanently discards any commits on this branch that ' +
        "aren't merged or pushed elsewhere. This cannot be undone.",
    });
    if (response !== 0) return { ok: false, cancelled: true, error: 'Branch deletion cancelled.' };
    return runGit(dir, ['branch', '-D', '--', branch]);
  });

  // Current branch for a worktree (reads .git/HEAD). Lets the sidebar refresh a
  // stale label after the user switches branch inside the worktree's terminal.
  ipcMain.handle('git:branch', (_e, cwd) => (isKnownDir(cwd) ? gitBranch(cwd) : null));

  // Clipboard bridge. The preload runs sandboxed, where `require('electron')`
  // does NOT expose the `clipboard` module (only ipcRenderer/contextBridge/etc),
  // so the renderer can't touch the clipboard directly — it has to hop to main.
  // Read is synchronous (sendSync) to keep the renderer's `readClipboard(): string`
  // contract; write is fire-and-forget.
  ipcMain.on('clipboard:read', (e) => {
    e.returnValue = clipboard.readText();
  });
  ipcMain.on('clipboard:write', (_e, text) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });

  // Open a terminal link in the user's default browser. Only http(s) — never
  // hand arbitrary schemes (file:, javascript:) to the OS shell.
  ipcMain.handle('open-external', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // Open a worktree in Visual Studio. Prefers a top-level .sln; otherwise opens
  // the folder ("Open Folder" mode). Returns an error string the UI can surface.
  ipcMain.handle('vs:open', (_e, cwd) =>
    isKnownDir(cwd) ? openInVisualStudio(cwd) : { error: 'Unknown directory.' }
  );

  // Open a worktree in VS Code via the `code` CLI (on PATH after install).
  ipcMain.handle('code:open', (_e, cwd) =>
    isKnownDir(cwd) ? openInVSCode(cwd) : { error: 'Unknown directory.' }
  );

  // Reveal a worktree in the OS file manager (Explorer / Finder / Files).
  ipcMain.handle('explorer:open', async (_e, cwd) => {
    if (!isKnownDir(cwd)) return { error: 'Unknown directory.' };
    const err = await shell.openPath(cwd); // returns '' on success
    return err ? { error: err } : { ok: true };
  });

  // Added + removed line counts for a worktree vs HEAD (staged + unstaged),
  // shown as a "+N/-M" badge in the sidebar.
  ipcMain.handle('git:diffstat', async (_e, cwd) => {
    if (!isKnownDir(cwd)) return { added: 0, removed: 0 };
    const { ok, stdout } = await execGit(cwd, ['diff', '--numstat', 'HEAD']);
    if (!ok) return { added: 0, removed: 0 };
    let added = 0;
    let removed = 0;
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
      if (m) {
        if (m[1] !== '-') added += +m[1];
        if (m[2] !== '-') removed += +m[2];
      }
    }
    return { added, removed };
  });

  // Full unified diff for the diff viewer. `mode`:
  //   wip    -> uncommitted working tree vs HEAD (staged + unstaged)
  //   branch -> this branch vs its base (origin/main …), i.e. the PR-style diff
  // Returns { ok, diff, base? } or { ok:false, error }. maxBuffer is bumped so a
  // large diff isn't truncated into a spawn error.
  ipcMain.handle('git:diff', async (_e, { cwd, mode }) => {
    if (!isKnownDir(cwd)) return { ok: false, error: 'Unknown directory.' };
    if (mode === 'branch') {
      const base = await resolveDiffBase(cwd);
      if (!base) return { ok: false, error: 'No base branch (origin/main, main, master…) found.' };
      const r = await execGit(cwd, ['diff', `${base}...HEAD`]);
      if (!r.ok) return { ok: false, error: r.stderr.trim() || String(r.error.message) };
      return { ok: true, diff: r.stdout, base };
    }

    const r = await execGit(cwd, ['diff', 'HEAD']);
    if (!r.ok) return { ok: false, error: r.stderr.trim() || String(r.error.message) };
    return { ok: true, diff: r.stdout };
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
      sandbox: true,
    },
  });
  // Never let window.open (or a target=_blank link) spawn a second, unmanaged
  // BrowserWindow — terminal links already route through open-external
  // (shell.openExternal), so there is no legitimate use of a new window here.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Block any renderer-initiated top-level navigation (e.g. a compromised
  // renderer setting window.location). The only real navigation — the initial
  // loadFile below — is issued from the main process and does not fire this
  // event, so this can safely deny unconditionally.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  mainWindow.loadFile(path.join('renderer', 'index.html'));
}

// Single-instance lock. A second launch would race the first on the JSON
// stores (projects.json / workspaces.json), so bail out early and hand focus
// back to the window that already owns them.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // A second instance would race the first on the JSON stores. app.quit() is
  // async and does not halt this script, so we MUST NOT fall through to
  // registerIpc()/startServer()/createWindow() below — guard the whole bootstrap.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null); // no File/Edit/View/Window/Help bar
    registerIpc();
    await startServer();
    createWindow();
    log.info('main', `app ready — logging to ${log.logFilePath()}`);
    await ensureHooksInstalled();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  for (const term of agents.values()) term.kill();
  if (process.platform !== 'darwin') app.quit();
});
