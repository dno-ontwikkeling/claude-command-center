// Builds the docs-management e2e fixture in %TEMP%\cc-docs-e2e:
//   repo/      git repo with plans, plans/archive, reviews, docs, README.md
//   repo-wt/   linked worktree of repo (branch wt)
//   home/      throwaway USERPROFILE/HOME so the app and claude never touch the real profile
//   userdata/  Electron --user-data-dir, pre-seeded projects.json with repo registered
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Long path: os.tmpdir() can be an 8.3 short name (OLIVIE~1.NEE) while git
// reports worktrees by their long name, and dir matching compares strings.
const E2E = path.join(fs.realpathSync.native(os.tmpdir()), 'cc-docs-e2e');
fs.rmSync(E2E, { recursive: true, force: true });
const repo = path.join(E2E, 'repo');
const files = {
  'plans/a.md': '# Plan A\n\nFirst plan.\n',
  'plans/b.md': '# Plan B\n\n| k | v |\n|---|---|\n| x | 1 |\n',
  'plans/archive/old.md': '# Old plan\n',
  'plans/archive/a.md': '# Plan A (archived earlier)\n',
  'reviews/r.html': '<h1>Review</h1><p>html review</p>',
  'docs/guide.md': '# Guide\n\nDocs folder.\n',
  'README.md': '# Fixture README\n',
};
let t = Date.now() / 1000 - 3600;
for (const [rel, body] of Object.entries(files)) {
  const f = path.join(repo, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  t += 60;
  fs.utimesSync(f, t, t); // stable newest-first order: README newest
}
const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
git('init', '-q', '-b', 'main');
git('add', '-A');
git('commit', '-qm', 'init');
git('worktree', 'add', '-q', path.join(E2E, 'repo-wt'), '-b', 'wt');

fs.mkdirSync(path.join(E2E, 'home', '.claude'), { recursive: true });
fs.mkdirSync(path.join(E2E, 'shots'), { recursive: true });
fs.mkdirSync(path.join(E2E, 'userdata'), { recursive: true });
fs.writeFileSync(path.join(E2E, 'userdata', 'projects.json'), JSON.stringify([{ dir: repo, name: 'repo' }], null, 2));
console.log(E2E);
