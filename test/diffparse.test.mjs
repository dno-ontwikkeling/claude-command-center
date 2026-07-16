import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, stripPrefix } from '../renderer/diff-parse.mjs';

test('empty input yields no files', () => {
  assert.deepEqual(parseDiff(''), []);
});

test('stripPrefix removes a/ and b/ only', () => {
  assert.equal(stripPrefix('a/src/x.js'), 'src/x.js');
  assert.equal(stripPrefix('b/src/x.js'), 'src/x.js');
  assert.equal(stripPrefix('src/x.js'), 'src/x.js');
  assert.equal(stripPrefix('/dev/null'), '/dev/null');
});

test('modified file: parses path, hunk header, and add/remove counts', () => {
  const diff = [
    'diff --git a/src/app.js b/src/app.js',
    'index 111..222 100644',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,3 +1,4 @@ function main()',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 3;',
    '+const c = 4;',
  ].join('\n');

  const [f] = parseDiff(diff);
  assert.equal(f.path, 'src/app.js');
  assert.equal(f.status, 'modified');
  assert.equal(f.binary, false);
  assert.equal(f.added, 2);
  assert.equal(f.removed, 1);
  assert.equal(f.hunks.length, 1);
  assert.equal(f.hunks[0].oldNo, 1);
  assert.equal(f.hunks[0].newNo, 1);
  assert.equal(f.hunks[0].header, 'function main()');
  assert.deepEqual(
    f.hunks[0].lines.map((l) => l.type),
    ['ctx', 'del', 'add', 'add']
  );
  assert.equal(f.hunks[0].lines[0].text, 'const a = 1;');
});

test('added (new) file', () => {
  const diff = [
    'diff --git a/new.txt b/new.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1,2 @@',
    '+line one',
    '+line two',
  ].join('\n');
  const [f] = parseDiff(diff);
  assert.equal(f.status, 'added');
  assert.equal(f.path, 'new.txt');
  assert.equal(f.added, 2);
  assert.equal(f.removed, 0);
});

test('deleted file', () => {
  const diff = [
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-was here',
  ].join('\n');
  const [f] = parseDiff(diff);
  assert.equal(f.status, 'deleted');
  assert.equal(f.removed, 1);
  // +++ was /dev/null, so path falls back to oldPath
  assert.equal(f.path, 'gone.txt');
});

test('renamed file captures old and new path', () => {
  const diff = [
    'diff --git a/old/name.js b/new/name.js',
    'similarity index 95%',
    'rename from old/name.js',
    'rename to new/name.js',
  ].join('\n');
  const [f] = parseDiff(diff);
  assert.equal(f.status, 'renamed');
  assert.equal(f.oldPath, 'old/name.js');
  assert.equal(f.path, 'new/name.js');
});

test('binary file is flagged', () => {
  const diff = [
    'diff --git a/img.png b/img.png',
    'index 111..222 100644',
    'Binary files a/img.png and b/img.png differ',
  ].join('\n');
  const [f] = parseDiff(diff);
  assert.equal(f.binary, true);
});

test('multiple files are parsed independently', () => {
  const diff = [
    'diff --git a/one.js b/one.js',
    '--- a/one.js',
    '+++ b/one.js',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    'diff --git a/two.js b/two.js',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/two.js',
    '@@ -0,0 +1 @@',
    '+hi',
  ].join('\n');
  const files = parseDiff(diff);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'one.js');
  assert.equal(files[0].added, 1);
  assert.equal(files[0].removed, 1);
  assert.equal(files[1].path, 'two.js');
  assert.equal(files[1].status, 'added');
});

test('CRLF line endings are tolerated', () => {
  const diff = [
    'diff --git a/x.js b/x.js',
    '--- a/x.js',
    '+++ b/x.js',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  ].join('\r\n');
  const [f] = parseDiff(diff);
  assert.equal(f.path, 'x.js');
  assert.equal(f.added, 1);
  assert.equal(f.removed, 1);
});
