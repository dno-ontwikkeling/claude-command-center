'use strict';

// The NSIS uninstaller runs hooks/uninstall-hooks.js under plain node. It must
// remove the skills Command Center owns from ~/.claude/skills and leave user
// skills, edited copies and extra files alone.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { planSync, applySync, SIDECAR } = require('../hooks/skillsync');

const SCRIPT = path.join(__dirname, '..', 'hooks', 'uninstall-hooks.js');

test('uninstall removes CC-owned skills and keeps unmarked, edited and extra files', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-uninst-'));
  try {
    const bundled = path.join(home, 'bundled');
    for (const n of ['cc-manage', 'cc-clean-worktrees']) {
      fs.mkdirSync(path.join(bundled, n), { recursive: true });
      fs.writeFileSync(path.join(bundled, n, 'SKILL.md'), `---\nname: ${n}\n---\n`);
    }
    const skills = path.join(home, '.claude', 'skills');
    applySync(planSync(bundled, skills));
    fs.writeFileSync(path.join(skills, 'cc-clean-worktrees', 'SKILL.md'), 'my edit\n');
    fs.mkdirSync(path.join(skills, 'mine'));
    fs.writeFileSync(path.join(skills, 'mine', 'SKILL.md'), 'user skill\n');
    fs.writeFileSync(path.join(skills, 'notes.txt'), 'extra');

    execFileSync(process.execPath, [SCRIPT], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: 'ignore',
    });

    assert.equal(fs.existsSync(path.join(skills, 'cc-manage')), false);
    assert.equal(fs.readFileSync(path.join(skills, 'cc-clean-worktrees', 'SKILL.md'), 'utf8'), 'my edit\n');
    assert.ok(fs.existsSync(path.join(skills, 'cc-clean-worktrees', SIDECAR)));
    assert.equal(fs.readFileSync(path.join(skills, 'mine', 'SKILL.md'), 'utf8'), 'user skill\n');
    assert.equal(fs.readFileSync(path.join(skills, 'notes.txt'), 'utf8'), 'extra');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('uninstall still removes the skills when settings.json is corrupt', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-uninst-'));
  try {
    const bundled = path.join(home, 'bundled');
    fs.mkdirSync(path.join(bundled, 'cc-manage'), { recursive: true });
    fs.writeFileSync(path.join(bundled, 'cc-manage', 'SKILL.md'), 'x\n');
    const skills = path.join(home, '.claude', 'skills');
    applySync(planSync(bundled, skills));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{ broken');

    execFileSync(process.execPath, [SCRIPT], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'ignore' });

    assert.equal(fs.existsSync(path.join(skills, 'cc-manage')), false);
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), '{ broken');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
