'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listDocs, readDoc } = require('../docs');

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

// --- listDocs ---------------------------------------------------------------

test('listDocs: returns [] when plans/ and reviews/ are missing', async () => {
  const cwd = tmp();
  assert.deepEqual(await listDocs(cwd), []);
});

test('listDocs: lists .md and .html from plans/ and reviews/ with rel, kind, mtimeMs, size', async () => {
  const cwd = tmp();
  write(cwd, 'plans/a.md', '# A', 1000);
  write(cwd, 'reviews/b.html', '<p>b</p>', 2000);
  const list = await listDocs(cwd);
  assert.equal(list.length, 2);
  const a = list.find((d) => d.rel === 'plans/a.md');
  const b = list.find((d) => d.rel === 'reviews/b.html');
  assert.ok(a, 'plans/a.md listed');
  assert.ok(b, 'reviews/b.html listed');
  assert.equal(a.kind, 'plans');
  assert.equal(b.kind, 'reviews');
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
  assert.equal(list[0].kind, 'reviews');
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
