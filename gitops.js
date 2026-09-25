'use strict';

// ---------------------------------------------------------------------------
// Git orchestration (worktree/branch operations, diff-base resolution). No
// electron dependency (child_process/./logger only) so it can be required
// standalone; main.js's IPC handlers call into these and layer on the
// electron-specific bits (dialogs, mainWindow). Porcelain/numstat parsing
// stays in ./gitinfo.js — this module only spawns git and shapes the result.
// ---------------------------------------------------------------------------

const { execFile } = require('child_process');
const path = require('path');
const log = require('./logger');
const {
  parseStatusPorcelain,
  parseWorktreePorcelain,
  parseBranchList,
  parseRemoteBranchList,
} = require('./gitinfo');

// Shared git runner: `git -C <dir> <args>`. Never rejects — resolves a
// consistent { ok, code, stdout, stderr, error } shape so every call site can
// keep its own existing fallback semantics (based on `ok`/`error`) while this
// helper takes care of the actual process spawn. On failure it logs via
// log.warn so a broken env (git not on PATH, corrupt repo, …) leaves a trail
// instead of silently producing an empty UI state (previously every call site
// below mapped a git error to a blank fallback with zero logging). maxBuffer
// defaults to 64MB — large output (e.g. a big diff) used to overflow the
// default 1MB buffer on some call sites but not others; now all of them share
// the same, larger, buffer.
function execGit(dir, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, ...args],
      { maxBuffer: 64 * 1024 * 1024, ...opts },
      (error, stdout, stderr) => {
        if (error) {
          log.warn('git', `git ${args.join(' ')} failed in ${dir}`, error);
        }
        resolve({
          ok: !error,
          code: error ? (error.code ?? null) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          error,
        });
      }
    );
  });
}

function runGit(cwd, args) {
  return execGit(cwd, args).then(({ ok, stdout, stderr, error }) => {
    const out = `${stdout}${stderr}`.trim();
    return { ok, out, error: ok ? null : out || String(error.message) };
  });
}

// Per-worktree git state: dirty file count and ahead/behind vs upstream.
function worktreeStatus(wtPath) {
  return execGit(wtPath, ['status', '--porcelain=v1', '--branch']).then(({ ok, stdout }) =>
    ok ? parseStatusPorcelain(stdout) : { dirty: 0, ahead: 0, behind: 0, upstream: null }
  );
}

// List all worktrees of a repo, each enriched with its dirty/ahead/behind state.
async function listWorktrees(dir) {
  const { ok, stdout } = await execGit(dir, ['worktree', 'list', '--porcelain']);
  const worktrees = ok ? parseWorktreePorcelain(stdout) : [];
  await Promise.all(worktrees.map(async (w) => Object.assign(w, await worktreeStatus(w.path))));
  return worktrees;
}

// Whether `wtPath` is still a registered worktree of `dir`. git reports paths
// with forward slashes; compare normalized (and case-insensitively on Windows).
// On a failed `worktree list` assume still registered — the caller then keeps
// treating the removal as failed instead of wiping a live worktree.
async function isWorktreeRegistered(dir, wtPath) {
  const { ok, stdout } = await execGit(dir, ['worktree', 'list', '--porcelain']);
  if (!ok) return true;
  const norm = (p) => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const target = norm(wtPath);
  return parseWorktreePorcelain(stdout).some((w) => norm(w.path) === target);
}

function listBranches(dir) {
  return execGit(dir, ['branch', '--format=%(refname:short)']).then(({ ok, stdout }) =>
    ok ? parseBranchList(stdout) : []
  );
}

// Remote-tracking branches (origin/*), minus the symbolic origin/HEAD pointer.
function listRemoteBranches(dir) {
  return execGit(dir, ['branch', '-r', '--format=%(refname:short)']).then(({ ok, stdout }) =>
    ok ? parseRemoteBranchList(stdout) : []
  );
}

// Resolve the branch a feature worktree should be diffed against. Prefers the
// remote's default branch (origin/HEAD -> e.g. origin/main), falling back to a
// local main / master. Returns null when none of those exist.
function resolveDiffBase(dir) {
  const verify = (ref) =>
    execGit(dir, ['rev-parse', '--verify', '--quiet', ref]).then(({ ok }) => ok);
  return new Promise((resolve) => {
    execGit(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).then(async ({ ok, stdout }) => {
      const ref = (stdout || '').trim();
      if (ok && ref) {
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

module.exports = {
  execGit,
  runGit,
  worktreeStatus,
  listWorktrees,
  isWorktreeRegistered,
  listBranches,
  listRemoteBranches,
  resolveDiffBase,
};
