'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planSync, applySync, removeOwned, SIDECAR, hashText } = require('../hooks/skillsync');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-skills-'));
}

function withDirs(fn) {
  const base = tmp();
  const bundled = path.join(base, 'bundled');
  const target = path.join(base, 'target');
  fs.mkdirSync(bundled);
  fs.mkdirSync(target);
  try {
    return fn({ bundled, target, base });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function writeSkill(root, name, text) {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, 'SKILL.md'), text);
}

const names = (list) => list.map((x) => x.name).sort();

test('missing skills are planned for install, then written with a sidecar holding the hash', () => {
  withDirs(({ bundled, target }) => {
    writeSkill(bundled, 'cc-manage', '---\nname: cc-manage\n---\r\nbody\r\n');
    writeSkill(bundled, 'cc-clean-worktrees', '---\nname: cc-clean-worktrees\n---\nbody\n');
    const plan = planSync(bundled, target);
    assert.deepEqual(names(plan.install), ['cc-clean-worktrees', 'cc-manage']);
    assert.deepEqual(plan.update, []);
    assert.deepEqual(plan.skip, []);

    const r = applySync(plan);
    assert.deepEqual(r.errors, []);
    const written = fs.readFileSync(path.join(target, 'cc-manage', 'SKILL.md'), 'utf8');
    assert.equal(written, '---\nname: cc-manage\n---\nbody\n'); // LF-normalized
    const side = JSON.parse(fs.readFileSync(path.join(target, 'cc-manage', SIDECAR), 'utf8'));
    assert.equal(side.hash, hashText(written));

    const again = planSync(bundled, target);
    assert.deepEqual(again.install, []);
    assert.deepEqual(again.update, []);
    assert.deepEqual(names(again.current), ['cc-clean-worktrees', 'cc-manage']);
  });
});

test('a CC-owned unedited copy is updated when the bundled skill changes', () => {
  withDirs(({ bundled, target }) => {
    writeSkill(bundled, 'cc-manage', 'v1\n');
    applySync(planSync(bundled, target));
    writeSkill(bundled, 'cc-manage', 'v2\n');
    const plan = planSync(bundled, target);
    assert.deepEqual(names(plan.update), ['cc-manage']);
    applySync(plan);
    assert.equal(fs.readFileSync(path.join(target, 'cc-manage', 'SKILL.md'), 'utf8'), 'v2\n');
  });
});

test('a user-edited copy is skipped as edited', () => {
  withDirs(({ bundled, target }) => {
    writeSkill(bundled, 'cc-manage', 'v1\n');
    applySync(planSync(bundled, target));
    fs.writeFileSync(path.join(target, 'cc-manage', 'SKILL.md'), 'v1 plus my tweak\n');
    writeSkill(bundled, 'cc-manage', 'v2\n');
    const plan = planSync(bundled, target);
    assert.deepEqual(plan.update, []);
    assert.equal(plan.skip.length, 1);
    assert.match(plan.skip[0].reason, /edited/);
  });
});

test('an unmarked copy (no sidecar, or an unreadable one) is left alone', () => {
  withDirs(({ bundled, target }) => {
    writeSkill(bundled, 'cc-manage', 'v1\n');
    writeSkill(bundled, 'cc-clean-worktrees', 'v1\n');
    writeSkill(target, 'cc-manage', 'mine\n');
    writeSkill(target, 'cc-clean-worktrees', 'mine too\n');
    fs.writeFileSync(path.join(target, 'cc-clean-worktrees', SIDECAR), '{ broken');
    const plan = planSync(bundled, target);
    assert.deepEqual(plan.install, []);
    assert.deepEqual(plan.update, []);
    assert.deepEqual(names(plan.skip), ['cc-clean-worktrees', 'cc-manage']);
    for (const s of plan.skip) assert.match(s.reason, /not installed by Command Center|unmarked/);
  });
});

test('a sidecar without SKILL.md counts as missing', () => {
  withDirs(({ bundled, target }) => {
    writeSkill(bundled, 'cc-manage', 'v1\n');
    fs.mkdirSync(path.join(target, 'cc-manage'));
    fs.writeFileSync(path.join(target, 'cc-manage', SIDECAR), JSON.stringify({ hash: 'x' }));
    assert.deepEqual(names(planSync(bundled, target).install), ['cc-manage']);
  });
});

test('planSync works when the target folder does not exist yet', () => {
  withDirs(({ bundled, base }) => {
    writeSkill(bundled, 'cc-manage', 'v1\n');
    const target = path.join(base, 'nested', 'skills');
    const plan = planSync(bundled, target);
    assert.deepEqual(names(plan.install), ['cc-manage']);
    assert.deepEqual(applySync(plan).errors, []);
    assert.ok(fs.existsSync(path.join(target, 'cc-manage', 'SKILL.md')));
  });
});

test('bundled folders without SKILL.md and plain files are ignored', () => {
  withDirs(({ bundled, target }) => {
    fs.mkdirSync(path.join(bundled, 'empty'));
    fs.writeFileSync(path.join(bundled, 'README.md'), 'x');
    const plan = planSync(bundled, target);
    assert.deepEqual(plan.install, []);
  });
});

test('removeOwned deletes CC-owned skills and keeps edited, unmarked and extra files', () => {
  withDirs(({ bundled, target }) => {
    writeSkill(bundled, 'cc-manage', 'v1\n');
    writeSkill(bundled, 'cc-clean-worktrees', 'v1\n');
    writeSkill(bundled, 'cc-extra', 'v1\n');
    applySync(planSync(bundled, target));
    // edited copy: keep
    fs.writeFileSync(path.join(target, 'cc-clean-worktrees', 'SKILL.md'), 'edited\n');
    // owned, plus a user's extra file: remove ours, keep theirs and the folder
    fs.writeFileSync(path.join(target, 'cc-extra', 'notes.txt'), 'mine');
    // unmarked user skill: keep
    writeSkill(target, 'my-skill', 'mine\n');

    const removed = removeOwned(target);
    assert.deepEqual(removed.sort(), ['cc-extra', 'cc-manage']);
    assert.equal(fs.existsSync(path.join(target, 'cc-manage')), false);
    assert.equal(fs.readFileSync(path.join(target, 'cc-clean-worktrees', 'SKILL.md'), 'utf8'), 'edited\n');
    assert.ok(fs.existsSync(path.join(target, 'cc-clean-worktrees', SIDECAR)));
    assert.equal(fs.existsSync(path.join(target, 'cc-extra', 'SKILL.md')), false);
    assert.equal(fs.existsSync(path.join(target, 'cc-extra', SIDECAR)), false);
    assert.equal(fs.readFileSync(path.join(target, 'cc-extra', 'notes.txt'), 'utf8'), 'mine');
    assert.equal(fs.readFileSync(path.join(target, 'my-skill', 'SKILL.md'), 'utf8'), 'mine\n');
  });
});

test('removeOwned on a missing folder removes nothing', () => {
  assert.deepEqual(removeOwned(path.join(os.tmpdir(), 'cc-skills-missing-' + Date.now())), []);
});
