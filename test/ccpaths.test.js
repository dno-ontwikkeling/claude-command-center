'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  canonicalPath,
  validateRootsPatch,
  repoFolderName,
  worktreePickerDir,
  isUnder,
  isDirectChild,
  loadRoots,
  saveRoots,
  ROOT_DEFAULTS,
} = require('../ccpaths');

const WIN = process.platform === 'win32';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-paths-'));
}

// ---- canonicalPath ---------------------------------------------------------

test('canonicalPath rejects an MSYS-style path on Windows with a clear message', { skip: !WIN && 'Windows-only' }, () => {
  assert.throws(() => canonicalPath('/c/projects/x'), /MSYS|Windows path/);
});

test('canonicalPath rejects empty and non-string input', () => {
  assert.throws(() => canonicalPath(''), /path/i);
  assert.throws(() => canonicalPath(undefined), /path/i);
  assert.throws(() => canonicalPath(42), /path/i);
});

test('canonicalPath resolves a missing path without touching disk', () => {
  const p = path.join(os.tmpdir(), 'cc-paths-does-not-exist', 'x');
  assert.equal(canonicalPath(p), path.resolve(p));
});

test('canonicalPath drops a trailing separator', () => {
  const d = tmpDir();
  try {
    assert.equal(canonicalPath(d + path.sep), canonicalPath(d));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('canonicalPath maps forward slashes and a lowercase drive letter to the real spelling', { skip: !WIN && 'Windows-only' }, () => {
  const d = tmpDir();
  try {
    const real = canonicalPath(d);
    assert.equal(canonicalPath(d.replace(/\\/g, '/')), real);
    assert.equal(canonicalPath(d[0].toLowerCase() + d.slice(1)), real);
    assert.match(real, /^[A-Z]:\\/);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('canonicalPath expands an 8.3 short name for an existing folder', { skip: !WIN && 'Windows-only' }, () => {
  // os.tmpdir() is often C:\Users\OLIVIE~1\AppData\Local\Temp.
  const d = tmpDir();
  try {
    assert.ok(!canonicalPath(d).includes('~'), canonicalPath(d));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// ---- validateRootsPatch ----------------------------------------------------

function deps(over = {}) {
  const base = tmpDir();
  const dirs = new Set();
  const mk = (...p) => {
    const d = path.join(base, ...p);
    fs.mkdirSync(d, { recursive: true });
    dirs.add(path.resolve(d).toLowerCase());
    return d;
  };
  return {
    base,
    mk,
    deps: {
      isDirectory: (p) => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      },
      home: path.join(base, 'home'),
      projects: [],
      current: { ...ROOT_DEFAULTS },
      ...over,
    },
  };
}

test('validateRootsPatch accepts two separate existing folders', () => {
  const { base, mk, deps: d } = deps();
  try {
    const wt = mk('wt');
    const ws = mk('ws');
    const r = validateRootsPatch({ worktreeRoot: wt, workspaceRoot: ws }, d);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.roots.worktreeRoot, canonicalPath(wt));
    assert.equal(r.roots.workspaceRoot, canonicalPath(ws));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('validateRootsPatch keeps the other root from current and unsets with an empty string', () => {
  const { base, mk, deps: d } = deps();
  try {
    const wt = mk('wt');
    const ws = mk('ws');
    d.current = { worktreeRoot: wt, workspaceRoot: ws };
    const r = validateRootsPatch({ worktreeRoot: '' }, d);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.roots, { worktreeRoot: '', workspaceRoot: ws });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('validateRootsPatch ignores unknown keys and rejects a non-string value', () => {
  const { base, deps: d } = deps();
  try {
    const r = validateRootsPatch({ worktreeRoot: 5 }, d);
    assert.equal(r.ok, false);
    assert.match(r.error, /Worktrees folder/);
    const r2 = validateRootsPatch({ evil: 'x' }, d);
    assert.equal(r2.ok, true);
    assert.deepEqual(Object.keys(r2.roots).sort(), ['workspaceRoot', 'worktreeRoot']);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

const rejects = [
  ['a relative path', () => 'relative\\dir', /absolute/i],
  ['a missing folder', (b) => path.join(b, 'missing'), /exist/i],
  ['a drive root', (b) => path.parse(b).root, /drive root|root/i],
  ['the home folder', (b, d) => d.home, /home/i],
];
for (const [name, val, re] of rejects) {
  test(`validateRootsPatch rejects ${name}`, () => {
    const { base, mk, deps: d } = deps();
    try {
      mk('home');
      const r = validateRootsPatch({ worktreeRoot: val(base, d) }, d);
      assert.equal(r.ok, false);
      assert.match(r.error, re);
      assert.match(r.error, /Worktrees folder/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
}

test('validateRootsPatch rejects a shell metacharacter and names it', () => {
  const { base, mk, deps: d } = deps();
  try {
    const bad = mk('a&b');
    const r = validateRootsPatch({ workspaceRoot: bad }, d);
    assert.equal(r.ok, false);
    assert.match(r.error, /Workspaces folder/);
    assert.match(r.error, /"&"/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('validateRootsPatch rejects equal roots', () => {
  const { base, mk, deps: d } = deps();
  try {
    const one = mk('one');
    const r = validateRootsPatch({ worktreeRoot: one, workspaceRoot: one }, d);
    assert.equal(r.ok, false);
    assert.match(r.error, /same folder|equal/i);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('validateRootsPatch rejects a root nested in the other root, either way', () => {
  const { base, mk, deps: d } = deps();
  try {
    const outer = mk('outer');
    const inner = mk('outer', 'inner');
    d.current = { worktreeRoot: outer, workspaceRoot: '' };
    const r = validateRootsPatch({ workspaceRoot: inner }, d);
    assert.equal(r.ok, false);
    assert.match(r.error, /inside/i);
    d.current = { worktreeRoot: '', workspaceRoot: inner };
    const r2 = validateRootsPatch({ worktreeRoot: outer }, d);
    assert.equal(r2.ok, false);
    assert.match(r2.error, /inside|contains/i);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('validateRootsPatch rejects a root inside or equal to a registered project', () => {
  const { base, mk, deps: d } = deps();
  try {
    const proj = mk('proj');
    const sub = mk('proj', 'wt');
    d.projects = [{ dir: proj, name: 'proj' }];
    for (const root of [proj, sub]) {
      const r = validateRootsPatch({ worktreeRoot: root }, d);
      assert.equal(r.ok, false, root);
      assert.match(r.error, /project/i);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('validateRootsPatch allows a root that contains registered projects', () => {
  const { base, mk, deps: d } = deps();
  try {
    const wt = mk('wt');
    d.projects = [{ dir: mk('wt', 'someproj'), name: 'someproj' }];
    assert.equal(validateRootsPatch({ worktreeRoot: wt }, d).ok, true);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---- small helpers ---------------------------------------------------------

test('repoFolderName is the last folder name of the project dir', () => {
  assert.equal(repoFolderName(path.join(os.tmpdir(), 'Github', 'MyRepo') + path.sep), 'MyRepo');
});

test('worktreePickerDir joins the root and the repo folder name, null without a root', () => {
  const root = path.join(os.tmpdir(), 'wt');
  assert.equal(worktreePickerDir(root, path.join(os.tmpdir(), 'x', 'Repo')), path.join(root, 'Repo'));
  assert.equal(worktreePickerDir('', path.join(os.tmpdir(), 'Repo')), null);
});

test('isUnder is a strict descendant check without .. escapes', () => {
  const root = path.join(os.tmpdir(), 'wt');
  assert.equal(isUnder(root, path.join(root, 'a', 'b')), true);
  assert.equal(isUnder(root, root), false);
  assert.equal(isUnder(root, root + '-other'), false);
  assert.equal(isUnder(root, path.join(root, '..', 'escape')), false);
  assert.equal(isUnder('', path.join(root, 'a')), false);
});

test('isUnder is case-insensitive on Windows', { skip: !WIN && 'Windows-only' }, () => {
  const root = 'C:\\Worktrees';
  assert.equal(isUnder(root, 'c:/worktrees/Repo/feat'), true);
});

test('isDirectChild accepts only one level below the root', () => {
  const root = path.join(os.tmpdir(), 'ws');
  assert.equal(isDirectChild(root, path.join(root, 'one')), true);
  assert.equal(isDirectChild(root, path.join(root, 'one') + path.sep), true);
  assert.equal(isDirectChild(root, path.join(root, 'one', 'two')), false);
  assert.equal(isDirectChild(root, root), false);
  assert.equal(isDirectChild('', path.join(root, 'one')), false);
});

// ---- load/save -------------------------------------------------------------

test('loadRoots returns defaults when the file is missing', () => {
  const d = tmpDir();
  try {
    assert.deepEqual(loadRoots(path.join(d, 'paths.json')), { roots: { ...ROOT_DEFAULTS } });
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('saveRoots then loadRoots round-trips and keeps only the root keys', () => {
  const d = tmpDir();
  try {
    const f = path.join(d, 'paths.json');
    saveRoots(f, { worktreeRoot: 'C:\\wt', workspaceRoot: '', extra: 1 });
    assert.deepEqual(loadRoots(f), { roots: { worktreeRoot: 'C:\\wt', workspaceRoot: '' } });
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('loadRoots falls back to defaults on a corrupt file and reports it', () => {
  const d = tmpDir();
  try {
    const f = path.join(d, 'paths.json');
    fs.writeFileSync(f, '{ not json');
    const r = loadRoots(f);
    assert.deepEqual(r.roots, { ...ROOT_DEFAULTS });
    assert.match(r.error, /parse/i);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('loadRoots drops non-string values', () => {
  const d = tmpDir();
  try {
    const f = path.join(d, 'paths.json');
    fs.writeFileSync(f, JSON.stringify({ worktreeRoot: 7, workspaceRoot: 'C:\\ws' }));
    assert.deepEqual(loadRoots(f).roots, { worktreeRoot: '', workspaceRoot: 'C:\\ws' });
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
