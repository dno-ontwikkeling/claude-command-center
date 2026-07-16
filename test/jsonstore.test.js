'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readJsonSafe, writeJsonAtomic, hasShellMeta } = require('../jsonstore');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-jsonstore-'));
}

test('readJsonSafe returns fallback for a missing file (first run)', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'nope.json');
  assert.deepEqual(readJsonSafe(file, []), []);
  assert.deepEqual(readJsonSafe(file, { a: 1 }), { a: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readJsonSafe parses valid JSON', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'ok.json');
  fs.writeFileSync(file, JSON.stringify([{ dir: 'x' }]));
  assert.deepEqual(readJsonSafe(file, []), [{ dir: 'x' }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readJsonSafe throws on corrupt JSON and does NOT return fallback (data-loss guard)', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, '{ not valid json ');
  assert.throws(() => readJsonSafe(file, []), /Could not parse/);
  // the corrupt file must be preserved as a .bak-* so data is recoverable
  const backups = fs.readdirSync(dir).filter((f) => f.startsWith('bad.json.bak-'));
  assert.equal(backups.length, 1, 'expected exactly one backup of the corrupt file');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeJsonAtomic round-trips and leaves no temp file behind', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'out.json');
  writeJsonAtomic(file, { hello: 'world', n: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { hello: 'world', n: 2 });
  const temps = fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));
  assert.equal(temps.length, 0, 'no orphaned temp file');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeJsonAtomic creates missing parent directories', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'nested', 'deep', 'out.json');
  writeJsonAtomic(file, { ok: true });
  assert.equal(fs.existsSync(file), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeJsonAtomic overwrites an existing file atomically', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'out.json');
  writeJsonAtomic(file, { v: 1 });
  writeJsonAtomic(file, { v: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { v: 2 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readJsonSafe reads back what writeJsonAtomic wrote', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'rt.json');
  const data = [{ dir: 'a', name: 'A' }, { dir: 'b', name: 'B' }];
  writeJsonAtomic(file, data);
  assert.deepEqual(readJsonSafe(file, []), data);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hasShellMeta flags command/shell metacharacters', () => {
  for (const bad of ['a&b', 'x|y', 'foo;bar', 'a>b', 'a<b', 'a(b)', 'a!b', 'a^b', 'a%b', 'a$b', 'a"b', "a'b", 'a`b', 'a\nb', 'R&D']) {
    assert.equal(hasShellMeta(bad), true, `expected metachar detected in ${JSON.stringify(bad)}`);
  }
});

test('hasShellMeta accepts ordinary names', () => {
  for (const ok of ['feature-login', 'my_branch', 'release.1.2', 'user/topic', 'plain', 'a-b_c.d']) {
    assert.equal(hasShellMeta(ok), false, `expected no metachar in ${JSON.stringify(ok)}`);
  }
});
