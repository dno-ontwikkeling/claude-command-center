'use strict';

// ---------------------------------------------------------------------------
// Worktree and branch checks for `/command` forget and worktree:remove.
//
// Electron-free and logger-free (gitops.js requires ./logger → electron, which
// can't load under plain `node --test`). The git runner is injected so tests
// can simulate a failing git; the default runs `git -C <dir> …` and never
// rejects.
// ---------------------------------------------------------------------------

const { execFile } = require('child_process');
const { parseWorktreePorcelain } = require('./gitinfo');
const { normPath } = require('./ccpaths');

function defaultGit(dir, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error ? (typeof error.code === 'number' ? error.code : null) : 0,
        stdout: stdout || '',
        stderr: stderr || '',
      });
    });
  });
}

function badRefName(name) {
  return typeof name !== 'string' || !name || name.startsWith('-');
}

function createWorktreeCheck(git = defaultGit) {
  // Linked worktrees of `dir` (the main checkout excluded), or null when git
  // fails.
  async function linkedWorktrees(dir) {
    let r;
    try {
      r = await git(dir, ['worktree', 'list', '--porcelain']);
    } catch {
      return null;
    }
    if (!r.ok) return null;
    return parseWorktreePorcelain(r.stdout).filter((w) => !w.isMain);
  }

  async function findWorktree(dir, wtPath) {
    if (typeof dir !== 'string' || !dir || typeof wtPath !== 'string' || !wtPath) return null;
    const list = await linkedWorktrees(dir);
    if (!list) return null;
    const target = normPath(wtPath);
    return list.find((w) => normPath(w.path) === target) || null;
  }

  // True only when git lists `wtPath` as a linked worktree of `dir`. A git
  // failure is false (unlike gitops.isWorktreeRegistered, which assumes true
  // so that a removal is not reported as done).
  async function isRegisteredWorktreeOf(dir, wtPath) {
    return (await findWorktree(dir, wtPath)) !== null;
  }

  // The branch checked out in that worktree, or null (unknown folder,
  // detached HEAD, git failure).
  async function worktreeBranchOf(dir, wtPath) {
    const w = await findWorktree(dir, wtPath);
    return w ? w.branch : null;
  }

  // Deletes `branch` only when it is an ancestor of `defaultRef` (e.g.
  // origin/main). Uses an explicit ancestor check plus `branch -D`, never
  // `branch -d`: with --no-track branches, -d compares against the main
  // checkout's HEAD, which may be a stale local main.
  async function deleteMergedBranch(dir, branch, defaultRef) {
    if (badRefName(branch) || badRefName(defaultRef)) {
      return { deleted: false, kept: true, reason: 'Invalid branch or base name.' };
    }
    const anc = await git(dir, ['merge-base', '--is-ancestor', branch, defaultRef]);
    if (!anc.ok) {
      const reason =
        anc.code === 1 ? `${branch} is not merged into ${defaultRef}.` : (anc.stderr || 'merge-base failed').trim();
      return { deleted: false, kept: true, reason };
    }
    const del = await git(dir, ['branch', '-D', '--', branch]);
    if (!del.ok) return { deleted: false, kept: true, reason: (del.stderr || 'git branch -D failed').trim() };
    return { deleted: true };
  }

  return { isRegisteredWorktreeOf, worktreeBranchOf, deleteMergedBranch };
}

module.exports = { createWorktreeCheck, ...createWorktreeCheck() };
