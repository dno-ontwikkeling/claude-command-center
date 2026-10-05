'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  listDocs,
  readDoc,
  resolveDoc,
  archiveDoc,
  restoreDoc,
  normalizeFolders,
  DEFAULT_FOLDERS,
  docFoldersFor,
  withDocFolders,
} = require('../docs');

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
  const res = await readDoc(cwd, undefined, 'plans/a.md');
  assert.equal(res.ok, true);
  assert.match(res.html, /<h1[^>]*>Title<\/h1>/);
  assert.match(res.html, /<li>one<\/li>/);
});

test('readDoc: passes html through unchanged', async () => {
  const cwd = tmp();
  const html = '<!doctype html><html><body><h2 id="x">Hi</h2></body></html>';
  write(cwd, 'reviews/r.html', html);
  const res = await readDoc(cwd, undefined, 'reviews/r.html');
  assert.equal(res.ok, true);
  assert.equal(res.html, html);
});

// --- readDoc: rejections ----------------------------------------------------

async function assertRejected(cwd, rel, folders) {
  let res;
  await assert.doesNotReject(async () => {
    res = await readDoc(cwd, folders, rel);
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
  const res = await readDoc(cwd, undefined, 'plans/edge.html');
  assert.equal(res.ok, true);
});

// --- resolveDoc / readDoc with configured folders ---------------------------

test('readDoc: a root doc opens when "." is configured, not by default', async () => {
  const cwd = tmp();
  write(cwd, 'README.md', '# Readme');
  const res = await readDoc(cwd, ['.'], 'README.md');
  assert.equal(res.ok, true);
  assert.match(res.html, /<h1[^>]*>Readme<\/h1>/);
  await assertRejected(cwd, 'README.md');
});

test('readDoc: archived docs open; other subfolders do not', async () => {
  const cwd = tmp();
  write(cwd, 'plans/archive/old.md', '# old');
  write(cwd, 'plans/sub/x.md', '# x');
  write(cwd, 'archive/root-old.md', '# r');
  assert.equal((await readDoc(cwd, undefined, 'plans/archive/old.md')).ok, true);
  assert.equal((await readDoc(cwd, ['.'], 'archive/root-old.md')).ok, true);
  await assertRejected(cwd, 'plans/sub/x.md');
  await assertRejected(cwd, 'plans/archive/../sub/x.md');
});

test('readDoc: a folder that is not configured is rejected', async () => {
  const cwd = tmp();
  write(cwd, 'docs/guide.md', '# g');
  write(cwd, 'plans/a.md', '# a');
  assert.equal((await readDoc(cwd, ['docs'], 'docs/guide.md')).ok, true);
  await assertRejected(cwd, 'docs/guide.md');
  await assertRejected(cwd, 'plans/a.md', ['docs']);
});

test('readDoc: nested configured folders resolve to the right folder', async () => {
  const cwd = tmp();
  write(cwd, 'docs/api/ref.md', '# ref');
  assert.equal((await readDoc(cwd, ['docs/api'], 'docs/api/ref.md')).ok, true);
  await assertRejected(cwd, 'docs/api/ref.md', ['docs']);
});

test('readDoc: a vanished file says so instead of throwing', async () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, 'plans'));
  const res = await readDoc(cwd, undefined, 'plans/gone.md');
  assert.equal(res.ok, false);
  assert.match(res.error, /gone\.md no longer exists/);
});

test('readDoc: a configured folder that links outside the project is rejected', async (t) => {
  const cwd = tmp();
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'secret.md'), '# secret');
  try {
    fs.symlinkSync(outside, path.join(cwd, 'docs'), 'junction');
  } catch (e) {
    t.skip(`links not permitted: ${e.code || e.message}`);
    return;
  }
  await assertRejected(cwd, 'docs/secret.md', ['docs']);
});

test('resolveDoc: returns the file, folder, archived flag and name', async () => {
  const cwd = tmp();
  write(cwd, 'plans/archive/old.md', 'x');
  const res = await resolveDoc(cwd, undefined, 'plans/archive/old.md');
  assert.equal(res.ok, true);
  assert.equal(res.folder, 'plans');
  assert.equal(res.archived, true);
  assert.equal(res.name, 'old.md');
  // .native, like fs.promises.realpath: it expands Windows 8.3 short names
  assert.equal(res.file, fs.realpathSync.native(path.join(cwd, 'plans', 'archive', 'old.md')));
});

// --- archiveDoc / restoreDoc ------------------------------------------------

const read = (cwd, rel) => fs.readFileSync(path.join(cwd, ...rel.split('/')), 'utf8');
const exists = (cwd, rel) => fs.existsSync(path.join(cwd, ...rel.split('/')));

test('archiveDoc: moves the doc into <folder>/archive/, creating it', async () => {
  const cwd = tmp();
  write(cwd, 'plans/a.md', 'A');
  const res = await archiveDoc(cwd, undefined, 'plans/a.md');
  assert.deepEqual(res, { ok: true, rel: 'plans/archive/a.md' });
  assert.equal(exists(cwd, 'plans/a.md'), false);
  assert.equal(read(cwd, 'plans/archive/a.md'), 'A');
});

test('archiveDoc: a name clash picks a free name and never overwrites', async () => {
  const cwd = tmp();
  write(cwd, 'plans/archive/a.md', 'first');
  write(cwd, 'plans/a.md', 'second');
  assert.deepEqual(await archiveDoc(cwd, undefined, 'plans/a.md'), { ok: true, rel: 'plans/archive/a (2).md' });
  write(cwd, 'plans/a.md', 'third');
  assert.deepEqual(await archiveDoc(cwd, undefined, 'plans/a.md'), { ok: true, rel: 'plans/archive/a (3).md' });
  assert.equal(read(cwd, 'plans/archive/a.md'), 'first');
  assert.equal(read(cwd, 'plans/archive/a (2).md'), 'second');
  assert.equal(read(cwd, 'plans/archive/a (3).md'), 'third');
});

test('restoreDoc: moves an archived doc back, with the same clash rule', async () => {
  const cwd = tmp();
  write(cwd, 'plans/archive/a.md', 'old');
  write(cwd, 'plans/a.md', 'new');
  assert.deepEqual(await restoreDoc(cwd, undefined, 'plans/archive/a.md'), { ok: true, rel: 'plans/a (2).md' });
  assert.equal(read(cwd, 'plans/a.md'), 'new');
  assert.equal(read(cwd, 'plans/a (2).md'), 'old');
  assert.equal(exists(cwd, 'plans/archive/a.md'), false);
});

test('archiveDoc / restoreDoc: refuse the wrong direction', async () => {
  const cwd = tmp();
  write(cwd, 'plans/a.md', 'x');
  write(cwd, 'plans/archive/b.md', 'y');
  const again = await archiveDoc(cwd, undefined, 'plans/archive/b.md');
  assert.equal(again.ok, false);
  const notArchived = await restoreDoc(cwd, undefined, 'plans/a.md');
  assert.equal(notArchived.ok, false);
  assert.equal(read(cwd, 'plans/a.md'), 'x');
  assert.equal(read(cwd, 'plans/archive/b.md'), 'y');
});

test('archiveDoc / restoreDoc: a missing file or guarded path is an error, never a throw', async () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, 'plans'));
  write(cwd, 'secret.md', 's');
  for (const [fn, rel] of [
    [archiveDoc, 'plans/gone.md'],
    [restoreDoc, 'plans/archive/gone.md'],
    [archiveDoc, '../secret.md'],
    [archiveDoc, 'secret.md'],
  ]) {
    let res;
    await assert.doesNotReject(async () => {
      res = await fn(cwd, undefined, rel);
    });
    assert.equal(res.ok, false, rel);
    assert.equal(typeof res.error, 'string');
  }
  assert.equal(read(cwd, 'secret.md'), 's');
});

test('archiveDoc / restoreDoc: work for root docs when "." is configured', async () => {
  const cwd = tmp();
  write(cwd, 'README.md', 'R');
  assert.deepEqual(await archiveDoc(cwd, ['.'], 'README.md'), { ok: true, rel: 'archive/README.md' });
  assert.deepEqual(await restoreDoc(cwd, ['.'], 'archive/README.md'), { ok: true, rel: 'README.md' });
  assert.equal(read(cwd, 'README.md'), 'R');
});

test('archiveDoc: an archive/ that links outside the folder is refused, file stays put', async (t) => {
  const cwd = tmp();
  const outside = tmp();
  write(cwd, 'plans/a.md', 'A');
  try {
    fs.symlinkSync(outside, path.join(cwd, 'plans', 'archive'), 'junction');
  } catch (e) {
    t.skip(`links not permitted: ${e.code || e.message}`);
    return;
  }
  const res = await archiveDoc(cwd, undefined, 'plans/a.md');
  assert.equal(res.ok, false);
  assert.equal(read(cwd, 'plans/a.md'), 'A');
  assert.deepEqual(fs.readdirSync(outside), []);
});
