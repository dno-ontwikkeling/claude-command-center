'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorktreeCheck, isRegisteredWorktreeOf, worktreeBranchOf, deleteMergedBranch } = require('../worktreecheck');

// CI has no git identity; every commit passes one explicitly.
const ID = ['-c', 'user.name=cc-test', '-c', 'user.email=cc-test@example.invalid'];
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...ID, ...args], { encoding: 'utf8' }).trim();

let base;
let repo;
let wtMerged;
let wtAhead;

before(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-wtcheck-')));
  repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  wtMerged = path.join(base, 'wt', 'merged');
  wtAhead = path.join(base, 'wt', 'ahead');
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/merged', wtMerged, 'main');
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/ahead', wtAhead, 'main');
  fs.writeFileSync(path.join(wtAhead, 'b.txt'), 'b\n');
  git(wtAhead, 'add', '.');
  git(wtAhead, 'commit', '-q', '-m', 'ahead');
  git(repo, 'branch', 'feat/loose-merged', 'main');
  git(repo, 'branch', 'feat/loose-ahead', 'feat/ahead');
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

// ---- isRegisteredWorktreeOf -----------------------------------------------

test('isRegisteredWorktreeOf is true for a linked worktree of the repo', async () => {
  assert.equal(await isRegisteredWorktreeOf(repo, wtMerged), true);
});

test('isRegisteredWorktreeOf matches other spellings of the same path', async () => {
  assert.equal(await isRegisteredWorktreeOf(repo, wtMerged.replace(/\\/g, '/') + '/'), true);
  if (process.platform === 'win32') {
    assert.equal(await isRegisteredWorktreeOf(repo, wtMerged.toUpperCase()), true);
  }
});

test('isRegisteredWorktreeOf is false for the main worktree, a stranger folder and a missing repo', async () => {
  assert.equal(await isRegisteredWorktreeOf(repo, repo), false);
  assert.equal(await isRegisteredWorktreeOf(repo, base), false);
  assert.equal(await isRegisteredWorktreeOf(path.join(base, 'nope'), wtMerged), false);
});

test('isRegisteredWorktreeOf is false when git fails, unlike gitops.isWorktreeRegistered', async () => {
  const failing = createWorktreeCheck(async () => ({ ok: false, code: 128, stdout: '', stderr: 'fatal' }));
  assert.equal(await failing.isRegisteredWorktreeOf(repo, wtMerged), false);
});

// ---- worktreeBranchOf ------------------------------------------------------

test('worktreeBranchOf returns the branch checked out in the worktree', async () => {
  assert.equal(await worktreeBranchOf(repo, wtAhead), 'feat/ahead');
});

test('worktreeBranchOf returns null for an unknown folder or a git failure', async () => {
  assert.equal(await worktreeBranchOf(repo, base), null);
  const failing = createWorktreeCheck(async () => ({ ok: false, code: 128, stdout: '', stderr: 'fatal' }));
  assert.equal(await failing.worktreeBranchOf(repo, wtAhead), null);
});

// ---- deleteMergedBranch ----------------------------------------------------

test('deleteMergedBranch deletes a branch that is an ancestor of the default ref', async () => {
  const r = await deleteMergedBranch(repo, 'feat/loose-merged', 'main');
  assert.deepEqual(r, { deleted: true });
  assert.equal(git(repo, 'branch', '--list', 'feat/loose-merged'), '');
});

test('deleteMergedBranch keeps an unmerged branch and says why', async () => {
  const r = await deleteMergedBranch(repo, 'feat/loose-ahead', 'main');
  assert.equal(r.deleted, false);
  assert.equal(r.kept, true);
  assert.match(r.reason, /not merged into main/);
  assert.match(git(repo, 'branch', '--list', 'feat/loose-ahead'), /feat\/loose-ahead/);
});

test('deleteMergedBranch keeps a branch when the ancestor check itself fails', async () => {
  const r = await deleteMergedBranch(repo, 'feat/does-not-exist', 'main');
  assert.equal(r.deleted, false);
  assert.equal(r.kept, true);
  assert.ok(r.reason);
});

test('deleteMergedBranch refuses option-like or empty names without running git', async () => {
  let calls = 0;
  const spy = createWorktreeCheck(async () => {
    calls++;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  });
  for (const [b, ref] of [['-D', 'main'], ['x', '--all'], ['', 'main'], ['x', '']]) {
    const r = await spy.deleteMergedBranch(repo, b, ref);
    assert.equal(r.deleted, false);
    assert.equal(r.kept, true);
  }
  assert.equal(calls, 0);
});

test('deleteMergedBranch keeps a merged branch that is still checked out in a worktree', async () => {
  const r = await deleteMergedBranch(repo, 'feat/merged', 'main');
  assert.equal(r.deleted, false);
  assert.equal(r.kept, true);
  assert.match(git(repo, 'branch', '--list', 'feat/merged'), /feat\/merged/);
});
