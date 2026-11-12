'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { trustKey, ensureTrusted } = require('../claudetrust');

const WIN = process.platform === 'win32';

function withFile(content, fn) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-trust-'));
  const f = path.join(d, '.claude.json');
  if (content !== undefined) fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  try {
    return fn(f, d);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

test('trustKey uses forward slashes and keeps casing', { skip: !WIN && 'Windows paths' }, () => {
  assert.equal(trustKey('C:\\Github\\Lansweeper.Packet'), 'C:/Github/Lansweeper.Packet');
  assert.equal(trustKey('C:\\Github\\x\\'), 'C:/Github/x');
});

test('trustKey upper-cases a lowercase drive letter like Claude does', { skip: !WIN && 'Windows paths' }, () => {
  assert.equal(trustKey('c:\\Github\\x'), 'C:/Github/x');
});

test('ensureTrusted adds the flag for missing projects and keeps every other key', () => {
  const p1 = path.join(os.tmpdir(), 'Repo');
  const p2 = path.join(os.tmpdir(), 'wt', 'Repo', 'feat');
  withFile(
    {
      numStartups: 7,
      projects: {
        [trustKey(p1)]: { allowedTools: ['x'], history: [1, 2] },
        'C:/Other': { hasTrustDialogAccepted: true },
      },
      oauthAccount: { a: 1 },
    },
    (f) => {
      const r = ensureTrusted(f, [p1, p2]);
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(r.changed.sort(), [trustKey(p1), trustKey(p2)].sort());
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      assert.equal(j.numStartups, 7);
      assert.deepEqual(j.oauthAccount, { a: 1 });
      assert.deepEqual(j.projects['C:/Other'], { hasTrustDialogAccepted: true });
      assert.deepEqual(j.projects[trustKey(p1)], { allowedTools: ['x'], history: [1, 2], hasTrustDialogAccepted: true });
      assert.deepEqual(j.projects[trustKey(p2)], { hasTrustDialogAccepted: true });
    }
  );
});

test('ensureTrusted flips a false flag to true', () => {
  const p = path.join(os.tmpdir(), 'Repo');
  withFile({ projects: { [trustKey(p)]: { hasTrustDialogAccepted: false } } }, (f) => {
    assert.deepEqual(ensureTrusted(f, [p]).changed, [trustKey(p)]);
    assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).projects[trustKey(p)].hasTrustDialogAccepted, true);
  });
});

test('ensureTrusted does not write when everything is already trusted', () => {
  const p = path.join(os.tmpdir(), 'Repo');
  const raw = JSON.stringify({ projects: { [trustKey(p)]: { hasTrustDialogAccepted: true } } });
  withFile(raw, (f) => {
    const before = fs.statSync(f).mtimeMs;
    const r = ensureTrusted(f, [p, p]);
    assert.deepEqual(r, { ok: true, changed: [] });
    assert.equal(fs.readFileSync(f, 'utf8'), raw);
    assert.equal(fs.statSync(f).mtimeMs, before);
  });
});

test('ensureTrusted treats a differently cased existing key as trusted on Windows', { skip: !WIN && 'Windows-only' }, () => {
  withFile({ projects: { 'C:/github/repo': { hasTrustDialogAccepted: true } } }, (f) => {
    assert.deepEqual(ensureTrusted(f, ['C:\\Github\\Repo']).changed, []);
  });
});

test('ensureTrusted creates the projects map when it is missing', () => {
  const p = path.join(os.tmpdir(), 'Repo');
  withFile({ numStartups: 1 }, (f) => {
    assert.equal(ensureTrusted(f, [p]).ok, true);
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.deepEqual(j.projects, { [trustKey(p)]: { hasTrustDialogAccepted: true } });
  });
});

test('ensureTrusted never writes a file that does not parse', () => {
  withFile('{ "projects": {', (f) => {
    const r = ensureTrusted(f, [path.join(os.tmpdir(), 'Repo')]);
    assert.equal(r.ok, false);
    assert.match(r.error, /parse/i);
    assert.equal(fs.readFileSync(f, 'utf8'), '{ "projects": {');
  });
});

test('ensureTrusted refuses a JSON root that is not an object, and a projects value that is not an object', () => {
  for (const content of ['[]', '"x"', '{"projects": []}', '{"projects": 3}']) {
    withFile(content, (f) => {
      const r = ensureTrusted(f, [path.join(os.tmpdir(), 'Repo')]);
      assert.equal(r.ok, false, content);
      assert.equal(fs.readFileSync(f, 'utf8'), content);
    });
  }
});

test('ensureTrusted does not create a missing file', () => {
  withFile(undefined, (f) => {
    const r = ensureTrusted(f, [path.join(os.tmpdir(), 'Repo')]);
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(f), false);
  });
});

test('ensureTrusted ignores empty or non-string paths', () => {
  withFile({ projects: {} }, (f) => {
    assert.deepEqual(ensureTrusted(f, ['', null, 3]), { ok: true, changed: [] });
  });
});
