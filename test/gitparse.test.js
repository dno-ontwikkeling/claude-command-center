'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseStatusPorcelain,
  parseWorktreePorcelain,
  parseBranchList,
  parseRemoteBranchList,
} = require('../gitinfo');

// --- parseStatusPorcelain ---------------------------------------------------

test('status: clean tree with upstream, no ahead/behind', () => {
  const out = '## main...origin/main\n';
  assert.deepEqual(parseStatusPorcelain(out), { dirty: 0, ahead: 0, behind: 0, upstream: 'origin/main' });
});

test('status: dirty files counted, ahead/behind parsed', () => {
  const out = ['## feat...origin/feat [ahead 2, behind 3]', ' M src/a.js', '?? new.txt', 'A  staged.js'].join('\n');
  assert.deepEqual(parseStatusPorcelain(out), { dirty: 3, ahead: 2, behind: 3, upstream: 'origin/feat' });
});

test('status: branch with no upstream', () => {
  const out = '## local-only\n';
  assert.deepEqual(parseStatusPorcelain(out), { dirty: 0, ahead: 0, behind: 0, upstream: null });
});

test('status: only ahead', () => {
  const out = '## main...origin/main [ahead 5]\n M x\n';
  assert.deepEqual(parseStatusPorcelain(out), { dirty: 1, ahead: 5, behind: 0, upstream: 'origin/main' });
});

// --- parseWorktreePorcelain -------------------------------------------------

test('worktree: main tree flagged isMain, branch ref stripped', () => {
  const out = [
    'worktree /repo',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree /repo-feature',
    'HEAD def456',
    'branch refs/heads/feature/x',
    '',
  ].join('\n');
  const wts = parseWorktreePorcelain(out);
  assert.equal(wts.length, 2);
  assert.deepEqual(wts[0], { path: '/repo', branch: 'main', isMain: true });
  assert.deepEqual(wts[1], { path: '/repo-feature', branch: 'feature/x' });
});

test('worktree: detached worktree has null branch', () => {
  const out = ['worktree /repo', 'HEAD abc123', 'detached', ''].join('\n');
  const wts = parseWorktreePorcelain(out);
  assert.equal(wts[0].branch, null);
  assert.equal(wts[0].isMain, true);
});

test('worktree: empty output yields no worktrees', () => {
  assert.deepEqual(parseWorktreePorcelain(''), []);
});

// --- parseBranchList --------------------------------------------------------

test('branchList: trims and drops blank lines', () => {
  assert.deepEqual(parseBranchList('main\nfeature/x\n\n  hotfix  \n'), ['main', 'feature/x', 'hotfix']);
});

// --- parseRemoteBranchList --------------------------------------------------

test('remoteBranchList: keeps remote/branch, drops origin/HEAD and bare names', () => {
  const out = ['origin/HEAD', 'origin/main', 'origin/feature/x', 'weird', ''].join('\n');
  assert.deepEqual(parseRemoteBranchList(out), ['origin/main', 'origin/feature/x']);
});
