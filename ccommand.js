'use strict';

// ---------------------------------------------------------------------------
// `/command` runner: what a Command Center session may ask CC to do through
// the hook server (POST /command, see hookserver.js). Three ops:
//
//   config  roots, registered projects/workspaces and the agent snapshot
//   spawn   start a session in a worktree of a registered project, in a
//           registered workspace, or in a new direct child of <ws-root>
//           (registered as a workspace first)
//   forget  stop every session in a folder under <wt-root>/<ws-root>, stop
//           tracking them, and optionally remove the worktree and delete its
//           merged branch
//
// The skills (/cc-manage, /cc-clean-worktrees) ask the user before calling
// spawn/forget; the guards here hold regardless. Every call is logged.
//
// Electron-free: everything main-process shaped is injected, so this is unit
// tested with stubs (test/ccommand.test.js).
// ---------------------------------------------------------------------------

const path = require('path');
const { canonicalPath, normPath, isUnder, isDirectChild } = require('./ccpaths');
const { hasShellMeta } = require('./jsonstore');
const { MAX_PROMPT } = require('./spawnargs');

const MAX_PATH = 4096;
const FORGET_TIMEOUT_MS = 120000;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const T = {
  path: (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_PATH,
  prompt: (v) => typeof v === 'string',
  optBool: (v) => v === undefined || typeof v === 'boolean',
};

// Per-op argument rules: key → validator. Keys not listed are rejected.
// test/skills-content.test.js checks the skills' heredocs against these keys.
const ARG_SCHEMA = {
  config: {},
  spawn: { dir: T.path, cwd: T.path, prompt: T.prompt },
  forget: { cwd: T.path, removeWorktree: T.optBool, deleteBranch: T.optBool, force: T.optBool },
};
const OPS = Object.freeze(Object.keys(ARG_SCHEMA));

function checkArgs(op, args) {
  if (!isObj(args)) throw new Error(`Invalid arguments for ${op}: expected a JSON object.`);
  const schema = ARG_SCHEMA[op];
  for (const k of Object.keys(args)) {
    if (!Object.prototype.hasOwnProperty.call(schema, k)) throw new Error(`Invalid argument for ${op}: unknown key "${k}".`);
  }
  for (const [k, ok] of Object.entries(schema)) {
    if (!ok(args[k])) throw new Error(`Invalid argument for ${op}: "${k}".`);
  }
}

const same = (a, b) => normPath(a) === normPath(b);
const sameOrUnder = (root, p) => same(root, p) || isUnder(root, p);

function createCommandRunner(deps) {
  const {
    roots,
    projects,
    workspaces,
    agents,
    isGit,
    defaultRef,
    validateWorktreeSpawn,
    registerWorkspace,
    trust,
    worktreeBranchOf,
    deleteMergedBranch,
    rendererCommand,
    isDirectory,
    log,
  } = deps;

  function canonRoots() {
    const r = roots() || {};
    const canon = (p) => (typeof p === 'string' && p ? canonicalPath(p) : '');
    return { worktreeRoot: canon(r.worktreeRoot), workspaceRoot: canon(r.workspaceRoot) };
  }

  async function config(callerId) {
    const r = canonRoots();
    const projs = await Promise.all(
      projects().map(async (p) => {
        const git = !!isGit(p.dir);
        return { dir: p.dir, name: p.name, isGit: git, defaultRef: git ? (await defaultRef(p.dir)) || null : null };
      })
    );
    return {
      worktreeRoot: r.worktreeRoot,
      workspaceRoot: r.workspaceRoot,
      projects: projs,
      workspaces: workspaces().map((w) => ({ dir: w.dir, name: w.name })),
      agents: agents().map((a) => ({
        id: a.id,
        cwd: a.cwd,
        dir: a.dir,
        branch: a.branch ?? null,
        status: a.status,
        live: !a.dormant,
        callerSelf: a.id === callerId,
      })),
    };
  }

  // Decide the target by `dir`: a registered project (any of its worktrees,
  // checked by validateWorktreeSpawn), a registered workspace (its own
  // folder), or a new direct child of <ws-root>. `dir` is replaced by the
  // stored record's exact string: the renderer compares dirs with ===.
  async function spawn({ dir, cwd, prompt }) {
    if (!prompt) throw new Error('A prompt is required.');
    if (prompt.includes('\0')) throw new Error('The prompt contains a NUL character.');
    if (prompt.length > MAX_PROMPT) throw new Error(`The prompt is too long (${prompt.length} > ${MAX_PROMPT} characters).`);
    const dirC = canonicalPath(dir);
    const cwdC = canonicalPath(cwd);

    let target;
    const proj = projects().find((p) => same(p.dir, dirC));
    const ws = !proj && workspaces().find((w) => same(w.dir, dirC));
    if (proj) {
      await validateWorktreeSpawn(proj.dir, cwdC);
      target = { dir: proj.dir, cwd: same(cwdC, proj.dir) ? proj.dir : cwdC, kind: 'project' };
    } else if (ws) {
      if (!same(cwdC, ws.dir)) throw new Error('A workspace session must run in the workspace folder (dir and cwd must be the same folder).');
      target = { dir: ws.dir, cwd: ws.dir, kind: 'workspace' };
    } else {
      const { worktreeRoot, workspaceRoot } = canonRoots();
      if (!same(cwdC, dirC)) throw new Error('A new workspace session must run in the workspace folder (dir and cwd must be the same folder).');
      if (!workspaceRoot) throw new Error('The Workspaces folder is not set in Command Center (Settings → General).');
      if (!isDirectChild(workspaceRoot, dirC)) {
        throw new Error(`${dirC} is not a registered project, and not a direct child of the Workspaces folder (${workspaceRoot}).`);
      }
      if (!isDirectory(dirC)) throw new Error(`${dirC} does not exist.`);
      if (hasShellMeta(path.basename(dirC))) throw new Error(`The folder name "${path.basename(dirC)}" contains a character that isn't allowed.`);
      if (worktreeRoot && sameOrUnder(worktreeRoot, dirC)) throw new Error(`${dirC} is inside the Worktrees folder.`);
      const inProject = projects().find((p) => sameOrUnder(p.dir, dirC));
      if (inProject) throw new Error(`${dirC} is inside the registered project "${inProject.name}".`);
      const inWorkspace = workspaces().find((w) => isUnder(w.dir, dirC));
      if (inWorkspace) throw new Error(`${dirC} is inside the registered workspace "${inWorkspace.name}".`);
      const rec = await registerWorkspace(dirC);
      if (!rec || rec.error) throw new Error(`Could not register the workspace: ${(rec && rec.error) || 'unknown error'}`);
      target = { dir: rec.dir || dirC, cwd: rec.dir || dirC, kind: 'workspace' };
    }

    // Pre-accept Claude's folder-trust prompt; a failure only means the user
    // sees that prompt in the new session.
    try {
      const t = await trust([target.dir, target.cwd]);
      if (t && t.ok === false) log.warn('command', `could not pre-set folder trust: ${t.error}`);
    } catch (err) {
      log.warn('command', 'could not pre-set folder trust', err);
    }

    const res = await rendererCommand('spawn', { dir: target.dir, cwd: target.cwd, prompt, kind: target.kind });
    return { id: res && res.id, ...target };
  }

  async function forget(callerId, { cwd, removeWorktree = false, deleteBranch = false, force = false }) {
    const cwdC = canonicalPath(cwd);
    const { worktreeRoot, workspaceRoot } = canonRoots();
    // Guards, all before anything is stopped.
    if (!isUnder(worktreeRoot, cwdC) && !isUnder(workspaceRoot, cwdC)) {
      throw new Error(`${cwdC} is outside the Worktrees folder and the Workspaces folder; forget only works below those.`);
    }
    const mainOf = projects().find((p) => same(p.dir, cwdC));
    if (mainOf) throw new Error(`${cwdC} is the main folder of the project "${mainOf.name}".`);
    const snapshot = agents();
    const caller = snapshot.find((a) => a.id === callerId);
    if (!caller) throw new Error('The calling session is not known to Command Center.');
    if (sameOrUnder(cwdC, caller.cwd)) throw new Error(`${cwdC} holds the calling session's own folder.`);

    const sessions = snapshot.filter((a) => same(a.cwd, cwdC));
    if (!sessions.length) {
      return { ok: false, noSessions: true, error: `No Command Center sessions run in ${cwdC}; remove it with git instead.` };
    }
    const dir = sessions[0].dir;
    const isWorkspace = workspaces().some((w) => w.dir === dir);
    if (removeWorktree && (isWorkspace || same(dir, cwdC))) throw new Error(`${cwdC} is not a worktree.`);

    const branch = removeWorktree || deleteBranch ? await worktreeBranchOf(dir, cwdC) : null;
    const res = await rendererCommand(
      'forgetIds',
      { ids: sessions.map((a) => a.id), cwd: sessions[0].cwd, dir, removeWorktree, force },
      { timeoutMs: FORGET_TIMEOUT_MS }
    );
    if (!res || !res.ok) {
      return {
        ok: false,
        ...(res && res.needsForce ? { needsForce: true } : {}),
        branch,
        branchDeleted: false,
        error: (res && res.error) || 'Forget failed.',
      };
    }
    const out = { ok: true, branch, branchDeleted: false };
    if (deleteBranch) {
      if (!branch) {
        out.branchKept = 'No branch is checked out in that folder.';
      } else {
        const ref = await defaultRef(dir);
        const d = ref ? await deleteMergedBranch(dir, branch, ref) : { deleted: false, reason: 'No default branch found.' };
        out.branchDeleted = !!d.deleted;
        if (!d.deleted) out.branchKept = d.reason || 'Branch kept.';
      }
    }
    return out;
  }

  // Runs one op. Resolves with the result, or rejects with an Error whose
  // message is safe to show the caller. Logs one line either way.
  async function run(callerId, op, args) {
    const cwd = isObj(args) && typeof args.cwd === 'string' ? args.cwd : '';
    const line = (outcome) => log.info('command', `caller=${callerId} op=${op} cwd=${cwd || '-'} → ${outcome}`);
    try {
      if (!Object.prototype.hasOwnProperty.call(ARG_SCHEMA, op)) throw new Error(`Unknown op "${op}".`);
      checkArgs(op, args);
      let result;
      if (op === 'config') result = await config(callerId);
      else if (op === 'spawn') result = await spawn(args);
      else result = await forget(callerId, args);
      line(result && result.ok === false ? `not done: ${result.error}` : 'ok');
      return result;
    } catch (err) {
      line(`refused/error: ${err.message}`);
      throw err;
    }
  }

  return { run };
}

module.exports = { createCommandRunner, OPS, ARG_SCHEMA };
