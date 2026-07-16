'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { gitBranch, isGitRepo, detectProjectType } = require('../gitinfo');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gitinfo-'));
}
function write(dir, rel, contents = '') {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

// --- gitBranch --------------------------------------------------------------

test('gitBranch reads a branch ref from .git/HEAD', () => {
  const dir = tmpDir();
  write(dir, '.git/HEAD', 'ref: refs/heads/feature/login\n');
  assert.equal(gitBranch(dir), 'feature/login');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gitBranch returns short sha for detached HEAD', () => {
  const dir = tmpDir();
  write(dir, '.git/HEAD', '1234567890abcdef1234567890abcdef12345678\n');
  assert.equal(gitBranch(dir), '1234567');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gitBranch follows a worktree .git file (gitdir pointer)', () => {
  const dir = tmpDir();
  // real .git dir for the worktree lives elsewhere
  const wtGit = path.join(dir, 'wt-git');
  write(dir, 'wt-git/HEAD', 'ref: refs/heads/wt-branch\n');
  // the checkout's .git is a FILE pointing at wtGit
  write(dir, 'checkout/.git', `gitdir: ${wtGit}\n`);
  assert.equal(gitBranch(path.join(dir, 'checkout')), 'wt-branch');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gitBranch returns null when not a git checkout', () => {
  const dir = tmpDir();
  assert.equal(gitBranch(dir), null);
  assert.equal(isGitRepo(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isGitRepo is true for a checkout', () => {
  const dir = tmpDir();
  write(dir, '.git/HEAD', 'ref: refs/heads/main\n');
  assert.equal(isGitRepo(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- detectProjectType ------------------------------------------------------

test('detectProjectType: null for an empty directory', () => {
  const dir = tmpDir();
  assert.equal(detectProjectType(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('detectProjectType recognises each language marker', () => {
  const cases = [
    ['package.json', 'node'],
    ['go.mod', 'go'],
    ['Cargo.toml', 'rust'],
    ['app.csproj', 'dotnet'],
    ['requirements.txt', 'python'],
  ];
  for (const [marker, type] of cases) {
    const dir = tmpDir();
    write(dir, marker);
    assert.equal(detectProjectType(dir), type, `${marker} -> ${type}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProjectType: .NET solution outranks an incidental package.json', () => {
  const dir = tmpDir();
  write(dir, 'package.json');
  write(dir, 'Solution.sln');
  assert.equal(detectProjectType(dir), 'dotnet');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('detectProjectType finds a marker in a nested subdirectory (within depth)', () => {
  const dir = tmpDir();
  write(dir, 'src/service/go.mod');
  assert.equal(detectProjectType(dir), 'go');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('detectProjectType ignores markers inside skipped dirs (node_modules)', () => {
  const dir = tmpDir();
  write(dir, 'node_modules/somepkg/go.mod'); // must be ignored
  assert.equal(detectProjectType(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('detectProjectType respects maxDepth', () => {
  const dir = tmpDir();
  write(dir, 'a/b/c/d/package.json'); // depth 4, beyond default maxDepth 3
  assert.equal(detectProjectType(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
