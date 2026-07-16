'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadSettings, hooksInstalled, mergeHooksInto } = require('../hooksmerge');

const HOOK_EVENTS = {
  SessionStart: 'busy',
  UserPromptSubmit: 'busy',
  PreToolUse: 'busy',
  Notification: 'needs-input',
  Stop: 'idle',
  SessionEnd: 'dead',
};
const REPORT_SCRIPT = '/opt/cc/hooks/report.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hooksmerge-'));
}

test('loadSettings: missing file (first run) loads as {}', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  const result = loadSettings(file);
  assert.deepEqual(result, { ok: true, settings: {} });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadSettings: valid existing settings are returned unmodified', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  const existing = { permissions: { allow: ['Bash'] }, model: 'sonnet' };
  fs.writeFileSync(file, JSON.stringify(existing));
  const result = loadSettings(file);
  assert.equal(result.ok, true);
  assert.deepEqual(result.settings, existing);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadSettings: corrupt settings.json aborts (ok:false) instead of falling back to {}', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ this is not valid json');
  const result = loadSettings(file);
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof Error);
  // the corrupt file must be preserved (backed up), never silently discarded
  const backups = fs.readdirSync(dir).filter((f) => f.startsWith('settings.json.bak-'));
  assert.equal(backups.length, 1, 'expected the corrupt file to be backed up');
  // and the original corrupt content must still be sitting at `file` — nothing
  // in the abort path may have touched/overwritten it
  assert.equal(fs.readFileSync(file, 'utf8'), '{ this is not valid json');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hooksInstalled: false when hooks are entirely absent', () => {
  assert.equal(hooksInstalled({}, HOOK_EVENTS, REPORT_SCRIPT), false);
});

test('hooksInstalled: false when only some events have a report.js command (partial/interrupted install)', () => {
  const settings = {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: `node "${REPORT_SCRIPT}" busy` }] }],
      // the rest are missing
    },
  };
  assert.equal(hooksInstalled(settings, HOOK_EVENTS, REPORT_SCRIPT), false);
});

test('hooksInstalled: true once every tracked event has a report.js command', () => {
  const settings = {};
  mergeHooksInto(settings, HOOK_EVENTS, REPORT_SCRIPT);
  assert.equal(hooksInstalled(settings, HOOK_EVENTS, REPORT_SCRIPT), true);
});

test('mergeHooksInto: preserves pre-existing unrelated keys (permissions, model prefs, other hooks)', () => {
  const settings = {
    permissions: { allow: ['Bash(git *)'] },
    model: 'sonnet',
    hooks: {
      SomeOtherHook: [{ hooks: [{ type: 'command', command: 'echo unrelated' }] }],
    },
  };
  mergeHooksInto(settings, HOOK_EVENTS, REPORT_SCRIPT);

  assert.deepEqual(settings.permissions, { allow: ['Bash(git *)'] });
  assert.equal(settings.model, 'sonnet');
  assert.deepEqual(settings.hooks.SomeOtherHook, [
    { hooks: [{ type: 'command', command: 'echo unrelated' }] },
  ]);
  // and every tracked event now has its report.js command
  for (const event of Object.keys(HOOK_EVENTS)) {
    assert.equal(settings.hooks[event].some((e) => e.hooks[0].command.includes('report.js')), true);
  }
});

test('mergeHooksInto: installs the correct status command per event', () => {
  const settings = {};
  mergeHooksInto(settings, HOOK_EVENTS, REPORT_SCRIPT);
  for (const [event, status] of Object.entries(HOOK_EVENTS)) {
    const commands = settings.hooks[event].flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(
      commands.some((c) => c === `node "${REPORT_SCRIPT}" ${status}`),
      `expected ${event} to carry status "${status}"`
    );
  }
});

test('mergeHooksInto: re-running on already-installed settings does not duplicate entries', () => {
  const settings = {};
  mergeHooksInto(settings, HOOK_EVENTS, REPORT_SCRIPT);
  const afterFirst = JSON.parse(JSON.stringify(settings));

  mergeHooksInto(settings, HOOK_EVENTS, REPORT_SCRIPT);
  mergeHooksInto(settings, HOOK_EVENTS, REPORT_SCRIPT);

  assert.deepEqual(settings, afterFirst);
  for (const event of Object.keys(HOOK_EVENTS)) {
    assert.equal(settings.hooks[event].length, 1, `expected exactly one entry for ${event}`);
  }
});

test('mergeHooksInto: a user-added entry alongside the hook for the same event is left alone (no duplicate report.js added)', () => {
  const settings = {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'echo custom' }] }],
    },
  };
  mergeHooksInto(settings, HOOK_EVENTS, REPORT_SCRIPT);
  // report.js gets appended once since Stop didn't have it yet...
  assert.equal(settings.hooks.Stop.length, 2);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'echo custom');
  // ...and re-running does not add a second copy.
  mergeHooksInto(settings, HOOK_EVENTS, REPORT_SCRIPT);
  assert.equal(settings.hooks.Stop.length, 2);
});
