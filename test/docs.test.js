'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listDocs, readDoc, normalizeFolders, DEFAULT_FOLDERS, docFoldersFor, withDocFolders } = require('../docs');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-docs-'));
}

function write(cwd, rel, content, mtimeSec) {
  const file = path.join(cwd, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mtimeSec !== undefined) fs.utimesSync(file, mtimeSec, mtimeSec);
  return file;
}

// --- normalizeFolders -------------------------------------------------------

test('normalizeFolders: keeps plain relative folders and the root', () => {
  assert.deepEqual(normalizeFolders(['plans', 'docs/api', '.']), { ok: true, folders: ['plans', 'docs/api', '.'] });
});

test('normalizeFolders: normalizes separators, trailing slashes, ./ and blank', () => {
  assert.deepEqual(normalizeFolders(['docs\\api', 'plans/', './reviews', '  ', '']).folders, [
    'docs/api',
    'plans',
    'reviews',
    '.',
  ]);
});

test('normalizeFolders: rejects anything that leaves the project', () => {
  for (const bad of ['..', 'a/../b', '../x', 'plans/./x', 'C:\\x', 'c:x', '/abs', '\\\\srv\\share', 'a\0b', 'a//b']) {
    const res = normalizeFolders([bad]);
    assert.equal(res.ok, false, JSON.stringify(bad));
    assert.equal(typeof res.error, 'string');
  }
});

test('normalizeFolders: rejects archive folders, which are listed automatically', () => {
  for (const bad of ['archive', 'plans/archive', 'Plans/Archive']) {
    assert.equal(normalizeFolders([bad]).ok, false, bad);
  }
  assert.equal(normalizeFolders(['archives', 'archive-old']).ok, true);
});

test('normalizeFolders: dedupes case-insensitively, keeping the first spelling', () => {
  assert.deepEqual(normalizeFolders(['Plans', 'plans', 'docs\\API', 'docs/api']).folders, ['Plans', 'docs/API']);
});

test('normalizeFolders: caps the list at 20 folders', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `f${i}`);
  assert.equal(normalizeFolders(twenty).ok, true);
  assert.equal(normalizeFolders([...twenty, 'f20']).ok, false);
});

test('normalizeFolders: empty list means the defaults', () => {
  assert.deepEqual(DEFAULT_FOLDERS, ['plans', 'reviews']);
  const res = normalizeFolders([]);
  assert.deepEqual(res, { ok: true, folders: ['plans', 'reviews'] });
  res.folders.push('x');
  assert.deepEqual(DEFAULT_FOLDERS, ['plans', 'reviews'], 'returned list must be a copy');
});

test('normalizeFolders: rejects non-arrays and non-string entries', () => {
  for (const bad of [undefined, null, 'plans', {}, [1], [null]]) {
    assert.equal(normalizeFolders(bad).ok, false, JSON.stringify(bad));
  }
});

// --- docFoldersFor / withDocFolders -----------------------------------------

const PROJ = path.resolve('/work/app');
const OTHER = path.resolve('/work/lib');

test('docFoldersFor: a record without docFolders, or no record, gives the defaults', () => {
  assert.deepEqual(docFoldersFor([{ dir: PROJ, name: 'app' }], PROJ), { folders: ['plans', 'reviews'], invalid: false });
  assert.deepEqual(docFoldersFor([], PROJ), { folders: ['plans', 'reviews'], invalid: false });
});

test('docFoldersFor: returns the stored folders of the matching record', () => {
  const records = [
    { dir: OTHER, name: 'lib', docFolders: ['notes'] },
    { dir: PROJ, name: 'app', docFolders: ['docs', '.'] },
  ];
  assert.deepEqual(docFoldersFor(records, PROJ), { folders: ['docs', '.'], invalid: false });
});

test('docFoldersFor: a corrupt stored list falls back to the defaults and is flagged', () => {
  for (const bad of [['../..'], 'plans', [42], ['archive']]) {
    const res = docFoldersFor([{ dir: PROJ, name: 'app', docFolders: bad }], PROJ);
    assert.deepEqual(res, { folders: ['plans', 'reviews'], invalid: true }, JSON.stringify(bad));
  }
});

test('docFoldersFor: matches a dir spelled with other separators (and case on Windows)', () => {
  const records = [{ dir: PROJ, name: 'app', docFolders: ['docs'] }];
  assert.deepEqual(docFoldersFor(records, PROJ.split(path.sep).join('/')).folders, ['docs']);
  if (process.platform === 'win32') assert.deepEqual(docFoldersFor(records, PROJ.toUpperCase()).folders, ['docs']);
});

test('withDocFolders: sets the field on the matching record only and leaves the input untouched', () => {
  const records = [
    { dir: OTHER, name: 'lib' },
    { dir: PROJ, name: 'app' },
  ];
  const snapshot = JSON.stringify(records);
  const res = withDocFolders(records, PROJ, ['docs', '.']);
  assert.equal(res.ok, true);
  assert.deepEqual(res.records, [
    { dir: OTHER, name: 'lib' },
    { dir: PROJ, name: 'app', docFolders: ['docs', '.'] },
  ]);
  assert.equal(JSON.stringify(records), snapshot);
  assert.strictEqual(res.records[0], records[0], 'untouched records are reused');
});

test('withDocFolders: saving the defaults removes the field', () => {
  const res = withDocFolders([{ dir: PROJ, name: 'app', docFolders: ['docs'] }], PROJ, ['plans', 'reviews']);
  assert.deepEqual(res.records, [{ dir: PROJ, name: 'app' }]);
  assert.ok(!('docFolders' in res.records[0]));
});

test('withDocFolders: an unknown dir is an error', () => {
  const res = withDocFolders([{ dir: OTHER, name: 'lib' }], PROJ, ['docs']);
  assert.equal(res.ok, false);
  assert.equal(typeof res.error, 'string');
});

test('cleanup: removing a project record drops its folders; re-adding starts on the defaults', () => {
  const saved = withDocFolders([{ dir: PROJ, name: 'app' }, { dir: OTHER, name: 'lib' }], PROJ, ['docs']).records;
  // same filter as the projects:remove / workspaces:remove handlers in main.js
  const removed = saved.filter((p) => p.dir !== PROJ);
  assert.ok(!JSON.stringify(removed).includes('docFolders'), 'nothing left behind');
  assert.deepEqual(docFoldersFor(removed, PROJ).folders, ['plans', 'reviews']);
  const readded = [...removed, { dir: PROJ, name: 'app' }];
  assert.deepEqual(docFoldersFor(readded, PROJ).folders, ['plans', 'reviews']);
});

test('cleanup: the same holds for a workspace-shaped record', () => {
  const ws = { dir: PROJ, name: 'scratch', created: 1 };
  const saved = withDocFolders([ws], PROJ, ['.']).records;
  assert.deepEqual(docFoldersFor(saved, PROJ).folders, ['.']);
  assert.deepEqual(docFoldersFor(saved.filter((w) => w.dir !== PROJ), PROJ).folders, ['plans', 'reviews']);
});

// --- listDocs ---------------------------------------------------------------

test('listDocs: returns [] when plans/ and reviews/ are missing', async () => {
  const cwd = tmp();
  assert.deepEqual(await listDocs(cwd), []);
});

test('listDocs: lists .md and .html from plans/ and reviews/ with rel, folder, archived, mtimeMs, size', async () => {
  const cwd = tmp();
  write(cwd, 'plans/a.md', '# A', 1000);
  write(cwd, 'reviews/b.html', '<p>b</p>', 2000);
  const list = await listDocs(cwd);
  assert.equal(list.length, 2);
  const a = list.find((d) => d.rel === 'plans/a.md');
  const b = list.find((d) => d.rel === 'reviews/b.html');
  assert.ok(a, 'plans/a.md listed');
  assert.ok(b, 'reviews/b.html listed');
  assert.equal(a.folder, 'plans');
  assert.equal(b.folder, 'reviews');
  assert.equal(a.archived, false);
  assert.equal(b.archived, false);
  assert.equal(a.size, 3);
  assert.equal(b.size, 8);
  assert.equal(a.mtimeMs, 1000 * 1000);
  assert.equal(b.mtimeMs, 2000 * 1000);
});

test('listDocs: sorted newest first across both folders', async () => {
  const cwd = tmp();
  write(cwd, 'plans/old.md', 'x', 1000);
  write(cwd, 'reviews/newest.html', 'x', 3000);
  write(cwd, 'plans/mid.md', 'x', 2000);
  const list = await listDocs(cwd);
  assert.deepEqual(
    list.map((d) => d.rel),
    ['reviews/newest.html', 'plans/mid.md', 'plans/old.md'],
  );
});

test('listDocs: ignores other extensions and folders', async () => {
  const cwd = tmp();
  write(cwd, 'plans/a.md', 'x', 1000);
  write(cwd, 'plans/notes.txt', 'x', 1000);
  write(cwd, 'plans/script.js', 'x', 1000);
  write(cwd, 'reviews/r.html', 'x', 1000);
  write(cwd, 'other/c.md', 'x', 1000);
  write(cwd, 'root.md', 'x', 1000);
  const list = await listDocs(cwd);
  assert.deepEqual(list.map((d) => d.rel).sort(), ['plans/a.md', 'reviews/r.html']);
});

test('listDocs: works when only one of the folders exists', async () => {
  const cwd = tmp();
  write(cwd, 'reviews/only.md', '# only', 1000);
  const list = await listDocs(cwd);
  assert.deepEqual(list.map((d) => d.rel), ['reviews/only.md']);
  assert.equal(list[0].folder, 'reviews');
});

test('listDocs: includes each folder\'s archive/ as archived entries', async () => {
  const cwd = tmp();
  write(cwd, 'plans/a.md', 'x', 2000);
  write(cwd, 'plans/archive/old.md', 'x', 1000);
  write(cwd, 'plans/archive/nested/deep.md', 'x', 1000);
  write(cwd, 'plans/sub/skip.md', 'x', 1000);
  const list = await listDocs(cwd);
  assert.deepEqual(
    list.map(({ rel, folder, archived }) => ({ rel, folder, archived })),
    [
      { rel: 'plans/a.md', folder: 'plans', archived: false },
      { rel: 'plans/archive/old.md', folder: 'plans', archived: true },
    ],
  );
});

test('listDocs: "." lists only root files, its archive/ included', async () => {
  const cwd = tmp();
  write(cwd, 'README.md', 'x', 3000);
  write(cwd, 'DESIGN.html', 'x', 2000);
  write(cwd, 'archive/old.md', 'x', 1000);
  write(cwd, 'plans/a.md', 'x', 1000);
  write(cwd, 'node_modules/pkg/README.md', 'x', 1000);
  const list = await listDocs(cwd, ['.']);
  assert.deepEqual(
    list.map(({ rel, folder, archived }) => ({ rel, folder, archived })),
    [
      { rel: 'README.md', folder: '.', archived: false },
      { rel: 'DESIGN.html', folder: '.', archived: false },
      { rel: 'archive/old.md', folder: '.', archived: true },
    ],
  );
});

test('listDocs: configured folders, nested ones and missing ones', async () => {
  const cwd = tmp();
  write(cwd, 'docs/guide.md', 'x', 2000);
  write(cwd, 'docs/api/ref.md', 'x', 1000);
  write(cwd, 'plans/a.md', 'x', 1000);
  const list = await listDocs(cwd, ['docs', 'docs/api', 'missing']);
  assert.deepEqual(list.map((d) => [d.rel, d.folder]), [
    ['docs/guide.md', 'docs'],
    ['docs/api/ref.md', 'docs/api'],
  ]);
});

test('listDocs: caps a folder at 500 entries', async () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, 'plans'));
  for (let i = 0; i < 501; i++) fs.writeFileSync(path.join(cwd, 'plans', `p${i}.md`), 'x');
  const list = await listDocs(cwd);
  assert.equal(list.length, 500);
});

// --- readDoc: success -------------------------------------------------------

test('readDoc: renders markdown to html', async () => {
  const cwd = tmp();
  write(cwd, 'plans/a.md', '# Title\n\n- one\n- two\n');
  const res = await readDoc(cwd, 'plans/a.md');
  assert.equal(res.ok, true);
  assert.match(res.html, /<h1[^>]*>Title<\/h1>/);
  assert.match(res.html, /<li>one<\/li>/);
});

test('readDoc: passes html through unchanged', async () => {
  const cwd = tmp();
  const html = '<!doctype html><html><body><h2 id="x">Hi</h2></body></html>';
  write(cwd, 'reviews/r.html', html);
  const res = await readDoc(cwd, 'reviews/r.html');
  assert.equal(res.ok, true);
  assert.equal(res.html, html);
});

// --- readDoc: rejections ----------------------------------------------------

async function assertRejected(cwd, rel) {
  let res;
  await assert.doesNotReject(async () => {
    res = await readDoc(cwd, rel);
  });
  assert.equal(res.ok, false, `expected ${JSON.stringify(rel)} to be rejected`);
  assert.equal(typeof res.error, 'string');
  assert.ok(res.error.length > 0);
  assert.equal(res.html, undefined);
}

test('readDoc: rejects .. traversal', async () => {
  const cwd = tmp();
  write(cwd, 'secret.md', '# secret');
  write(cwd, 'plans/a.md', '# a');
  await assertRejected(cwd, '../secret.md');
  await assertRejected(cwd, 'plans/../secret.md');
  await assertRejected(cwd, 'plans/../../secret.md');
  await assertRejected(cwd, 'plans\\..\\secret.md');
});

test('readDoc: rejects absolute paths', async () => {
  const cwd = tmp();
  const abs = write(cwd, 'plans/a.md', '# a');
  await assertRejected(cwd, abs);
  await assertRejected(cwd, '/plans/a.md');
});

test('readDoc: rejects other extensions', async () => {
  const cwd = tmp();
  write(cwd, 'plans/notes.txt', 'text');
  write(cwd, 'plans/app.js', 'alert(1)');
  write(cwd, 'plans/noext', 'x');
  await assertRejected(cwd, 'plans/notes.txt');
  await assertRejected(cwd, 'plans/app.js');
  await assertRejected(cwd, 'plans/noext');
});

test('readDoc: rejects paths outside plans/ and reviews/', async () => {
  const cwd = tmp();
  write(cwd, 'other/c.md', '# c');
  write(cwd, 'root.md', '# root');
  await assertRejected(cwd, 'other/c.md');
  await assertRejected(cwd, 'root.md');
});

test('readDoc: rejects a missing file without throwing', async () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, 'plans'));
  await assertRejected(cwd, 'plans/missing.md');
});

test('readDoc: rejects a symlink pointing outside the folder', async (t) => {
  const cwd = tmp();
  const outside = tmp();
  const target = path.join(outside, 'secret.md');
  fs.writeFileSync(target, '# secret');
  fs.mkdirSync(path.join(cwd, 'plans'));
  const link = path.join(cwd, 'plans', 'link.md');
  try {
    fs.symlinkSync(target, link);
  } catch (e) {
    t.skip(`symlinks not permitted: ${e.code || e.message}`);
    return;
  }
  await assertRejected(cwd, 'plans/link.md');
});

test('readDoc: rejects files over 2 MB', async () => {
  const cwd = tmp();
  write(cwd, 'plans/big.md', Buffer.alloc(2 * 1024 * 1024 + 1, 'a'));
  await assertRejected(cwd, 'plans/big.md');
});

test('readDoc: accepts a file of exactly 2 MB', async () => {
  const cwd = tmp();
  write(cwd, 'plans/edge.html', Buffer.alloc(2 * 1024 * 1024, 'a'));
  const res = await readDoc(cwd, 'plans/edge.html');
  assert.equal(res.ok, true);
});
