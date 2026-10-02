import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff } from '../../renderer/diff-parse.mjs';
import { statSummary, fileRows, opToast, limitDiff } from '../www/js/git-model.mjs';

const DIFF = [
  'diff --git a/src/app.js b/src/app.js',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '-old',
  '+new',
  '+more',
  'diff --git a/README.md b/README.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/README.md',
  '@@ -0,0 +1 @@',
  '+hello',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-bye',
].join('\n');

test('statSummary shows counts, or a clear "no changes"', () => {
  assert.equal(statSummary({ added: 12, removed: 3 }), '+12 −3');
  assert.equal(statSummary({ added: 0, removed: 0 }), 'No uncommitted changes');
  assert.equal(statSummary(null), 'No uncommitted changes');
});

test('fileRows: name/folder split, status letter, counts, sorted by path', () => {
  assert.deepEqual(fileRows(parseDiff(DIFF)), [
    { path: 'gone.txt', name: 'gone.txt', folder: '', letter: 'D', status: 'deleted', added: 0, removed: 1, binary: false },
    { path: 'README.md', name: 'README.md', folder: '', letter: 'A', status: 'added', added: 1, removed: 0, binary: false },
    { path: 'src/app.js', name: 'app.js', folder: 'src', letter: 'M', status: 'modified', added: 2, removed: 1, binary: false },
  ]);
});

test('opToast: success shows git output or a default, failure shows the first error line', () => {
  assert.deepEqual(opToast('pull', { ok: true, out: 'Already up to date.\n' }), { kind: 'ok', text: 'Already up to date.' });
  assert.deepEqual(opToast('fetch', { ok: true }), { kind: 'ok', text: 'Fetched.' });
  assert.deepEqual(opToast('pull', { ok: false, error: 'fatal: Not possible to fast-forward, aborting.\nmore' }), {
    kind: 'error',
    text: 'fatal: Not possible to fast-forward, aborting.',
  });
  assert.deepEqual(opToast('pull', { ok: false }), { kind: 'error', text: 'Pull failed.' });
});

test('limitDiff keeps whole files up to a line budget and flags truncation', () => {
  const files = parseDiff(DIFF);
  const all = limitDiff(files, 1000);
  assert.equal(all.truncated, false);
  assert.equal(all.files.length, 3);
  const some = limitDiff(files, 4);
  assert.equal(some.truncated, true);
  assert.deepEqual(some.files.map((f) => f.path), ['src/app.js']);
});
