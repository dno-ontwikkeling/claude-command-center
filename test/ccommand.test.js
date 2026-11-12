'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCommandRunner, OPS, ARG_SCHEMA } = require('../ccommand');

const WIN = process.platform === 'win32';

// Real folders, so canonicalPath/realpath behave as in the app:
//   base/wt/Repo/feat        worktree of base/Repo (session a1 = the caller)
//   base/wt/Repo/other       worktree of base/Repo (sessions a2 live, a3 sleeping)
//   base/ws/scratch          existing child of <ws-root>, unregistered
//   base/ws/known            registered workspace (session a4)
let base, repo, plainProj, wtRoot, wsRoot, wtFeat, wtOther, wsScratch, wsKnown;

before(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cmd-')));
  const mk = (...p) => {
    const d = path.join(base, ...p);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  repo = mk('Repo');
  plainProj = mk('Notes');
  wtRoot = mk('wt');
  wsRoot = mk('ws');
  wtFeat = mk('wt', 'Repo', 'feat');
  wtOther = mk('wt', 'Repo', 'other');
  wsScratch = mk('ws', 'scratch');
  wsKnown = mk('ws', 'known');
  mk('ws', 'a&b');
});

after(() => fs.rmSync(base, { recursive: true, force: true }));

function setup(over = {}) {
  const calls = { renderer: [], trust: [], registered: [], deleted: [], logs: [] };
  const deps = {
    roots: () => ({ worktreeRoot: wtRoot, workspaceRoot: wsRoot }),
    projects: () => [
      { dir: repo, name: 'Repo' },
      { dir: plainProj, name: 'Notes' },
    ],
    workspaces: () => [{ dir: wsKnown, name: 'known' }],
    agents: () => [
      { id: 'a1', dir: repo, cwd: wtFeat, branch: 'feat/feat', status: 'busy', dormant: false, isMain: false },
      { id: 'a2', dir: repo, cwd: wtOther, branch: 'feat/other', status: 'idle', dormant: false, isMain: false },
      { id: 'a3', dir: repo, cwd: wtOther, branch: 'feat/other', status: '', dormant: true, isMain: false },
      { id: 'a4', dir: wsKnown, cwd: wsKnown, branch: null, status: 'idle', dormant: false, isMain: true },
    ],
    isGit: (dir) => dir === repo,
    defaultRef: async (dir) => (dir === repo ? 'origin/main' : null),
    validateWorktreeSpawn: async (dir, cwd) => {
      if (dir !== repo) throw new Error('Unknown project.');
      if (![repo, wtFeat, wtOther].some((p) => p.toLowerCase() === cwd.toLowerCase())) {
        throw new Error('Not a worktree of this project.');
      }
    },
    registerWorkspace: async (dir) => {
      calls.registered.push(dir);
      return { dir, name: path.basename(dir) };
    },
    trust: async (paths) => {
      calls.trust.push(paths);
      return { ok: true, changed: [] };
    },
    worktreeBranchOf: async (dir, cwd) => (cwd.toLowerCase() === wtOther.toLowerCase() ? 'feat/other' : null),
    deleteMergedBranch: async (dir, branch, ref) => {
      calls.deleted.push([dir, branch, ref]);
      return { deleted: true };
    },
    rendererCommand: async (op, args, opts) => {
      calls.renderer.push({ op, args, opts });
      if (op === 'spawn') return { id: 'new1' };
      return { ok: true };
    },
    isDirectory: (p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    },
    log: {
      info: (...a) => calls.logs.push(['info', ...a]),
      warn: (...a) => calls.logs.push(['warn', ...a]),
    },
    ...over,
  };
  return { run: createCommandRunner(deps).run, calls, deps };
}

// ---- protocol --------------------------------------------------------------

test('OPS lists the three ops and ARG_SCHEMA covers each', () => {
  assert.deepEqual([...OPS].sort(), ['config', 'forget', 'spawn']);
  for (const op of OPS) assert.ok(ARG_SCHEMA[op], op);
  assert.deepEqual(Object.keys(ARG_SCHEMA.spawn).sort(), ['cwd', 'dir', 'prompt']);
  assert.deepEqual(Object.keys(ARG_SCHEMA.forget).sort(), ['cwd', 'deleteBranch', 'force', 'removeWorktree']);
});

test('an unknown op is rejected and logged', async () => {
  const { run, calls } = setup();
  await assert.rejects(run('a1', 'nuke', {}), /Unknown op/);
  assert.equal(calls.logs.length, 1);
});

test('unknown argument keys and wrong types are rejected', async () => {
  const { run } = setup();
  await assert.rejects(run('a1', 'config', { x: 1 }), /argument/i);
  await assert.rejects(run('a1', 'spawn', { dir: repo, cwd: wtFeat, prompt: 5 }), /argument/i);
  await assert.rejects(run('a1', 'forget', { cwd: wtOther, force: 'yes' }), /argument/i);
  await assert.rejects(run('a1', 'spawn', null), /argument/i);
});

test('every call leaves one info line with caller id, op, cwd and outcome', async () => {
  const { run, calls } = setup();
  await run('a1', 'spawn', { dir: repo, cwd: wtOther, prompt: '/x hi' });
  await assert.rejects(run('a1', 'forget', { cwd: wtFeat }));
  const infos = calls.logs.filter((l) => l[0] === 'info');
  assert.equal(infos.length, 2);
  assert.match(infos[0].join(' '), /a1.*spawn.*other.*ok/);
  assert.match(infos[1].join(' '), /a1.*forget.*feat.*refused|error/);
});

// ---- config ----------------------------------------------------------------

test('config returns roots, projects with isGit/defaultRef, workspaces and agents with callerSelf', async () => {
  const { run } = setup();
  const c = await run('a2', 'config', {});
  assert.equal(c.worktreeRoot, wtRoot);
  assert.equal(c.workspaceRoot, wsRoot);
  assert.deepEqual(c.projects, [
    { dir: repo, name: 'Repo', isGit: true, defaultRef: 'origin/main' },
    { dir: plainProj, name: 'Notes', isGit: false, defaultRef: null },
  ]);
  assert.deepEqual(c.workspaces, [{ dir: wsKnown, name: 'known' }]);
  const a2 = c.agents.find((a) => a.id === 'a2');
  assert.deepEqual(a2, { id: 'a2', cwd: wtOther, dir: repo, branch: 'feat/other', status: 'idle', live: true, callerSelf: true });
  assert.equal(c.agents.find((a) => a.id === 'a3').live, false);
  assert.equal(c.agents.find((a) => a.id === 'a1').callerSelf, false);
});

test('config reports unset roots as empty strings', async () => {
  const { run } = setup({ roots: () => ({ worktreeRoot: '', workspaceRoot: '' }) });
  const c = await run('a1', 'config', {});
  assert.equal(c.worktreeRoot, '');
  assert.equal(c.workspaceRoot, '');
});

// ---- spawn -----------------------------------------------------------------

test('spawn into a worktree of a registered project trusts both folders and asks the renderer', async () => {
  const { run, calls } = setup();
  const prompt = '/workflow:work brief\nwith "quotes" and é';
  const r = await run('a1', 'spawn', { dir: repo, cwd: wtOther, prompt });
  assert.deepEqual(r, { id: 'new1', dir: repo, cwd: wtOther, kind: 'project' });
  assert.deepEqual(calls.trust, [[repo, wtOther]]);
  assert.deepEqual(calls.renderer, [{ op: 'spawn', args: { dir: repo, cwd: wtOther, prompt, kind: 'project' }, opts: undefined }]);
});

test('spawn substitutes the stored project dir string for other spellings', { skip: !WIN && 'Windows spellings' }, async () => {
  const { run, calls } = setup();
  const spellings = [repo.replace(/\\/g, '/'), repo[0].toLowerCase() + repo.slice(1), repo + '\\'];
  for (const dir of spellings) {
    const cwd = wtOther.replace(/\\/g, '/') + '/';
    await run('a1', 'spawn', { dir, cwd, prompt: 'x' });
  }
  for (const c of calls.renderer) {
    assert.equal(c.args.dir, repo);
    assert.equal(c.args.cwd, wtOther);
  }
});

test('spawn rejects an MSYS path with a clear message', { skip: !WIN && 'Windows-only' }, async () => {
  const { run, calls } = setup();
  await assert.rejects(run('a1', 'spawn', { dir: '/c/x/Repo', cwd: wtOther, prompt: 'x' }), /MSYS/);
  assert.equal(calls.renderer.length, 0);
});

test('spawn rejects a cwd that is not a worktree of the project', async () => {
  const { run, calls } = setup();
  await assert.rejects(run('a1', 'spawn', { dir: repo, cwd: wsScratch, prompt: 'x' }), /Not a worktree/);
  assert.equal(calls.renderer.length, 0);
  assert.equal(calls.trust.length, 0);
});

test('spawn rejects a prompt over 8,000 characters, an empty prompt and a NUL', async () => {
  const { run, calls } = setup();
  await assert.rejects(run('a1', 'spawn', { dir: repo, cwd: wtOther, prompt: 'x'.repeat(8001) }), /8000|too long/);
  await assert.rejects(run('a1', 'spawn', { dir: repo, cwd: wtOther, prompt: '' }), /prompt/i);
  await assert.rejects(run('a1', 'spawn', { dir: repo, cwd: wtOther, prompt: 'a\0b' }), /NUL/);
  assert.equal(calls.renderer.length, 0);
});

test('spawn into a registered non-git project runs in its own folder', async () => {
  const { run, calls } = setup({
    validateWorktreeSpawn: async (dir, cwd) => {
      if (dir.toLowerCase() !== cwd.toLowerCase()) throw new Error('Not a worktree of this project.');
    },
  });
  const r = await run('a1', 'spawn', { dir: plainProj, cwd: plainProj, prompt: 'x' });
  assert.equal(r.kind, 'project');
  assert.equal(calls.renderer[0].args.dir, plainProj);
});

test('spawn into a new direct child of <ws-root> registers it as a workspace', async () => {
  const { run, calls } = setup();
  const r = await run('a1', 'spawn', { dir: wsScratch, cwd: wsScratch, prompt: 'x' });
  assert.deepEqual(r, { id: 'new1', dir: wsScratch, cwd: wsScratch, kind: 'workspace' });
  assert.deepEqual(calls.registered, [wsScratch]);
  assert.deepEqual(calls.trust, [[wsScratch, wsScratch]]);
  assert.equal(calls.renderer[0].args.kind, 'workspace');
});

test('spawn into an already registered workspace uses its stored dir and registers nothing', async () => {
  const { run, calls } = setup();
  const r = await run('a1', 'spawn', { dir: wsKnown + path.sep, cwd: wsKnown, prompt: 'x' });
  assert.equal(r.kind, 'workspace');
  assert.equal(r.dir, wsKnown);
  assert.deepEqual(calls.registered, []);
});

test('spawn refuses a workspace target that is not a direct child of <ws-root>, or dir ≠ cwd', async () => {
  const { run, calls } = setup();
  const nested = path.join(wsScratch, 'deeper');
  fs.mkdirSync(nested, { recursive: true });
  await assert.rejects(run('a1', 'spawn', { dir: nested, cwd: nested, prompt: 'x' }), /Workspaces folder|direct/i);
  await assert.rejects(run('a1', 'spawn', { dir: wsScratch, cwd: nested, prompt: 'x' }), /same folder|dir and cwd/i);
  await assert.rejects(run('a1', 'spawn', { dir: base, cwd: base, prompt: 'x' }), /Workspaces folder|direct/i);
  assert.equal(calls.renderer.length, 0);
  assert.deepEqual(calls.registered, []);
});

test('spawn refuses a missing <ws-root> child, an unset <ws-root>, and a shell metacharacter in the name', async () => {
  const { run } = setup();
  await assert.rejects(run('a1', 'spawn', { dir: path.join(wsRoot, 'missing'), cwd: path.join(wsRoot, 'missing'), prompt: 'x' }), /exist/i);
  const amp = path.join(wsRoot, 'a&b');
  await assert.rejects(run('a1', 'spawn', { dir: amp, cwd: amp, prompt: 'x' }), /character/i);
  const unset = setup({ roots: () => ({ worktreeRoot: wtRoot, workspaceRoot: '' }) });
  await assert.rejects(unset.run('a1', 'spawn', { dir: wsScratch, cwd: wsScratch, prompt: 'x' }), /Workspaces folder/);
});

test('spawn continues when setting trust fails, and logs it', async () => {
  const { run, calls } = setup({ trust: async () => ({ ok: false, error: 'Could not parse' }) });
  await run('a1', 'spawn', { dir: repo, cwd: wtOther, prompt: 'x' });
  assert.equal(calls.renderer.length, 1);
  assert.ok(calls.logs.some((l) => l[0] === 'warn' && /trust/i.test(l.join(' '))));
});

// ---- forget ----------------------------------------------------------------

test('forget refuses the caller’s own folder before anything is stopped', async () => {
  const { run, calls } = setup();
  await assert.rejects(run('a1', 'forget', { cwd: wtFeat, removeWorktree: true }), /calling session|own folder/i);
  assert.equal(calls.renderer.length, 0);
});

test('forget refuses a folder that contains the caller’s folder', async () => {
  const { run, calls } = setup();
  await assert.rejects(run('a1', 'forget', { cwd: path.join(wtRoot, 'Repo') }), /calling session|own folder/i);
  assert.equal(calls.renderer.length, 0);
});

test('forget refuses a project main folder', async () => {
  const { run, calls } = setup({ roots: () => ({ worktreeRoot: base, workspaceRoot: wsRoot }) });
  await assert.rejects(run('a4', 'forget', { cwd: repo }), /main folder/i);
  assert.equal(calls.renderer.length, 0);
});

test('forget refuses a folder outside both roots, and the roots themselves', async () => {
  const { run, calls } = setup();
  for (const cwd of [base, wtRoot, wsRoot, path.join(os.tmpdir(), 'elsewhere')]) {
    await assert.rejects(run('a4', 'forget', { cwd }), /Worktrees folder|Workspaces folder|outside/i, cwd);
  }
  assert.equal(calls.renderer.length, 0);
});

test('forget refuses when the caller is unknown', async () => {
  const { run, calls } = setup();
  await assert.rejects(run('ghost', 'forget', { cwd: wtOther }), /calling session is not known/i);
  assert.equal(calls.renderer.length, 0);
});

test('forget with no sessions in the folder says so and stops nothing', async () => {
  const { run, calls } = setup();
  const empty = path.join(wtRoot, 'Repo', 'none');
  const r = await run('a4', 'forget', { cwd: empty, removeWorktree: true });
  assert.equal(r.ok, false);
  assert.equal(r.noSessions, true);
  assert.equal(calls.renderer.length, 0);
});

test('forget stops every session in the folder and removes the worktree once', async () => {
  const { run, calls } = setup();
  const r = await run('a4', 'forget', { cwd: wtOther.replace(/\\/g, '/'), removeWorktree: true });
  assert.deepEqual(r, { ok: true, branch: 'feat/other', branchDeleted: false });
  assert.equal(calls.renderer.length, 1);
  const c = calls.renderer[0];
  assert.equal(c.op, 'forgetIds');
  assert.deepEqual(c.args, { ids: ['a2', 'a3'], cwd: wtOther, dir: repo, removeWorktree: true, force: false });
  assert.deepEqual(c.opts, { timeoutMs: 120000 });
  assert.deepEqual(calls.deleted, []);
});

test('forget with deleteBranch deletes it through the ancestor check against defaultRef', async () => {
  const { run, calls } = setup();
  const r = await run('a4', 'forget', { cwd: wtOther, removeWorktree: true, deleteBranch: true });
  assert.deepEqual(r, { ok: true, branch: 'feat/other', branchDeleted: true });
  assert.deepEqual(calls.deleted, [[repo, 'feat/other', 'origin/main']]);
});

test('forget reports a kept, unmerged branch', async () => {
  const { run } = setup({ deleteMergedBranch: async () => ({ deleted: false, kept: true, reason: 'feat/other is not merged into origin/main.' }) });
  const r = await run('a4', 'forget', { cwd: wtOther, removeWorktree: true, deleteBranch: true });
  assert.equal(r.ok, true);
  assert.equal(r.branchDeleted, false);
  assert.match(r.branchKept, /not merged/);
});

test('forget on a dirty worktree without force returns needsForce and deletes no branch', async () => {
  const { run, calls } = setup({
    rendererCommand: async (op, args) => {
      calls.renderer.push({ op, args });
      return { ok: false, needsForce: !args.force, error: 'contains modified or untracked files' };
    },
  });
  const r = await run('a4', 'forget', { cwd: wtOther, removeWorktree: true, deleteBranch: true });
  assert.equal(r.ok, false);
  assert.equal(r.needsForce, true);
  assert.match(r.error, /modified/);
  assert.equal(r.branchDeleted, false);
  assert.deepEqual(calls.deleted, []);
});

test('forget passes force through', async () => {
  const { run, calls } = setup();
  await run('a4', 'forget', { cwd: wtOther, removeWorktree: true, force: true });
  assert.equal(calls.renderer[0].args.force, true);
});

test('forget refuses removeWorktree for a workspace folder', async () => {
  const { run, calls } = setup();
  await assert.rejects(run('a1', 'forget', { cwd: wsKnown, removeWorktree: true }), /not a worktree/i);
  assert.equal(calls.renderer.length, 0);
});

test('forget of a workspace folder without removeWorktree stops its sessions', async () => {
  const { run, calls } = setup();
  const r = await run('a1', 'forget', { cwd: wsKnown });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.renderer[0].args, { ids: ['a4'], cwd: wsKnown, dir: wsKnown, removeWorktree: false, force: false });
});

test('a renderer failure in forget surfaces as an error result', async () => {
  const { run } = setup({ rendererCommand: async () => { throw new Error('Desktop did not respond.'); } });
  await assert.rejects(run('a4', 'forget', { cwd: wtOther }), /did not respond/);
});
