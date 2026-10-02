'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listDirs, isDirectory } = require('../remotefs');

function tmpTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccfs-'));
  fs.mkdirSync(path.join(root, 'beta'));
  fs.mkdirSync(path.join(root, 'Alpha'));
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'file.txt'), 'x');
  return root;
}

test('listDirs returns sorted subfolders only, no hidden folders or files', async () => {
  const root = tmpTree();
  const res = await listDirs(root);
  assert.equal(res.path, path.resolve(root));
  assert.equal(res.parent, path.dirname(path.resolve(root)));
  assert.deepEqual(res.dirs, ['Alpha', 'beta', 'node_modules']);
});

test('listDirs without a path starts at the roots: home and drives', async () => {
  const res = await listDirs();
  assert.equal(res.path, null);
  assert.ok(res.dirs.includes(os.homedir()));
});

test('listDirs at a drive root has no parent', async () => {
  const res = await listDirs(path.parse(os.tmpdir()).root);
  assert.equal(res.parent, null);
});

test('listDirs rejects a missing folder with a readable error', async () => {
  await assert.rejects(listDirs(path.join(os.tmpdir(), 'does-not-exist-ccfs')), /not found/i);
});

test('isDirectory', async () => {
  const root = tmpTree();
  assert.equal(await isDirectory(root), true);
  assert.equal(await isDirectory(path.join(root, 'file.txt')), false);
  assert.equal(await isDirectory(path.join(root, 'nope')), false);
});
