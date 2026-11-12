'use strict';

// The bundled skills are prose for the model, but the parts that talk to
// Command Center must match the code: the ops they call through $CC_CLI and
// the JSON keys they send must be ones ccommand.js accepts.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OPS, ARG_SCHEMA } = require('../ccommand');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const SKILLS = ['cc-manage', 'cc-clean-worktrees'];

function read(name) {
  return fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
}

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(m, 'frontmatter block');
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

test('both skills are bundled', () => {
  const dirs = fs.readdirSync(SKILLS_DIR).filter((d) => fs.existsSync(path.join(SKILLS_DIR, d, 'SKILL.md')));
  assert.deepEqual(dirs.sort(), [...SKILLS].sort());
});

for (const name of SKILLS) {
  test(`${name}: frontmatter name matches the folder and has a description`, () => {
    const fm = frontmatter(read(name));
    assert.equal(fm.name, name);
    assert.ok(fm.description && fm.description.length > 40, 'description');
  });

  test(`${name}: every $CC_CLI op is a ccommand op`, () => {
    const text = read(name);
    const ops = [...text.matchAll(/node "\$CC_CLI" ([\w-]+)/g)].map((m) => m[1]);
    assert.ok(ops.length > 0, 'calls $CC_CLI');
    assert.ok(ops.includes('config'), 'reads config');
    for (const op of ops) assert.ok(OPS.includes(op), `unknown op ${op}`);
  });

  test(`${name}: heredoc JSON keys match ccommand.ARG_SCHEMA`, () => {
    const text = read(name);
    const blocks = [...text.matchAll(/node "\$CC_CLI" ([\w-]+) <<'CC_ARGS_EOF'\r?\n([\s\S]*?)\r?\nCC_ARGS_EOF/g)];
    for (const [, op, body] of blocks) {
      const keys = [...body.matchAll(/"(\w+)"\s*:/g)].map((m) => m[1]);
      assert.ok(keys.length > 0, `${op} heredoc has keys`);
      for (const k of keys) assert.ok(Object.prototype.hasOwnProperty.call(ARG_SCHEMA[op], k), `${op}: unknown key ${k}`);
    }
    // Ops with arguments are called with a heredoc; config without stdin.
    for (const m of text.matchAll(/node "\$CC_CLI" (spawn|forget)(?! <<'CC_ARGS_EOF')/g)) {
      assert.fail(`${m[1]} called without a CC_ARGS_EOF heredoc`);
    }
    for (const m of text.matchAll(/node "\$CC_CLI" config(?! < \/dev\/null)/g)) {
      assert.fail(`config called without < /dev/null: ${m[0]}`);
    }
  });

  test(`${name}: stops outside a Command Center session`, () => {
    assert.match(read(name), /Command Center session/);
  });
}

test('cc-manage spawns, cc-clean-worktrees forgets', () => {
  assert.match(read('cc-manage'), /node "\$CC_CLI" spawn <<'CC_ARGS_EOF'/);
  assert.match(read('cc-clean-worktrees'), /node "\$CC_CLI" forget <<'CC_ARGS_EOF'/);
});
