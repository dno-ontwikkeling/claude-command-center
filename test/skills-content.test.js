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

// cc-manage asks which workflow command starts each new session.

function section(text, n) {
  const start = text.indexOf(`\n## ${n}.`);
  assert.ok(start >= 0, `section ${n}`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

const WORKFLOW_COMMANDS = ['/workflow:auto', '/workflow:brainstorm', '/workflow:plan'];

test('cc-manage offers exactly the three workflow commands', () => {
  const found = new Set(read('cc-manage').match(/\/workflow:[\w-]+/g) || []);
  assert.deepEqual([...found].sort(), WORKFLOW_COMMANDS);
});

test('cc-manage step 4 picks the sessions to create with a multi-select question', () => {
  const step4 = section(read('cc-manage'), 4);
  assert.match(step4, /AskUserQuestion/);
  assert.match(step4, /header `Create`/i);
  assert.match(step4, /multiSelect/);
  assert.match(step4, /one\s+option\s+per\s+`create`\s+row/i);
  // A question holds at most 4 options: more rows are split over several Create questions.
  assert.match(step4, /more\s+than\s+4\s+rows/);
  assert.match(step4, /`skipped: not selected`/);
  assert.match(step4, /^- `Other` with changes[^\n]*(\n {2}[^\n]*)*starting\s+command/m, 'Other can change the command');
});

test('cc-manage step 4 asks one Start question per session, with context and a prompt preview', () => {
  const step4 = section(read('cc-manage'), 4);
  assert.match(step4, /header `Start #<n>`/i);
  assert.match(step4, /one\s+question\s+per\s+session/);
  assert.match(step4, /at\s+most\s+4\s+per\s+AskUserQuestion\s+call/);
  assert.doesNotMatch(step4, /shared\s+question/);
  assert.match(step4, /<goal in one sentence>/, 'question carries a little context');
  assert.match(step4, /`preview`/, 'options preview the prompt that gets sent');
  for (const cmd of WORKFLOW_COMMANDS) assert.ok(step4.includes(`\`${cmd}\``), `step 4 lists ${cmd}`);
  assert.match(step4, /\(Recommended\)/);
  assert.match(step4, /`Other`[^.]*any\s+other\s+skill/, 'free-text Other names any other skill');
});

test('cc-manage shows `ask` in the table until a command is chosen', () => {
  const text = read('cc-manage');
  assert.match(section(text, 2), /`ask`/);
  assert.match(section(text, 3), /`ask`/);
});

test('cc-manage falls back to picking the skill itself without the workflow plugin', () => {
  const step2 = section(read('cc-manage'), 2);
  assert.match(step2, /workflow\s+plugin\s+is\s+not\s+installed/);
  assert.match(step2, /best\s+fit/);
  // /workflow:auto is user-invocable only, so it is not in the model's skill
  // list; requiring it there would always trigger the fallback.
  assert.doesNotMatch(step2, /lacks[^.]*`workflow:auto`/);
  assert.match(step2, /`\/workflow:auto`\s+is\s+not\s+in\s+that\s+list/);
  assert.match(section(read('cc-manage'), 3), /workflow\s+plugin\s+is\s+not\s+installed/, 'says so under the table');
});

test('cc-manage first prompt is the chosen command plus the brief, under 8,000 characters', () => {
  const text = read('cc-manage');
  assert.match(text, /`\/<command> <brief>`/);
  assert.match(text, /under 8,000\s+characters/);
  assert.doesNotMatch(text, /`\/<skill> <brief>`/);
});
