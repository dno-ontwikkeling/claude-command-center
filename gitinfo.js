'use strict';

// ---------------------------------------------------------------------------
// Git + project-type inspection. No electron dependency (fs/path only) so it can
// be unit tested under `node --test` (see test/gitinfo.test.js). main.js requires
// this and wraps detectProjectType in a per-dir cache.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

// Current branch of a checkout WITHOUT shelling out to git: read .git/HEAD.
// Handles worktrees (where .git is a file "gitdir: <path>") and detached HEAD
// (returns the short sha). Returns null when dir is not a git checkout.
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

module.exports = { gitBranch, isGitRepo, detectProjectType, PTYPE_SKIP_DIRS };
