'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

// ---------------------------------------------------------------------------
// editors.js binds `const { execFile } = require('child_process')` once at
// module load, so patching child_process.execFile only takes effect for a
// *fresh* require of editors.js (require.cache deleted first). fs.* is used
// as `fs.existsSync(...)` / `fs.readdirSync(...)` (property access at call
// time), so patching fs directly affects any already-loaded instance too.
// ---------------------------------------------------------------------------

const editorsPath = require.resolve('../editors');

function loadEditorsWithExecFile(execFileMock) {
  const original = cp.execFile;
  cp.execFile = execFileMock;
  delete require.cache[editorsPath];
  const mod = require('../editors');
  cp.execFile = original; // editors.js already captured the mock via destructuring
  return mod;
}

function setPlatform(value) {
  const orig = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value, configurable: true });
  return () => Object.defineProperty(process, 'platform', orig);
}

async function withFsMock(overrides, fn) {
  const orig = {};
  for (const key of Object.keys(overrides)) {
    orig[key] = fs[key];
    fs[key] = overrides[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(orig)) fs[key] = orig[key];
  }
}

// execFile mock for openInVSCode: normalizes the (file, args, [options], cb)
// signature and dispatches on `file` being the 'where'/'which' finder vs. the
// actual launch (cmd.exe on win32, `code` directly elsewhere).
function makeVSCodeExecFileMock({ findStdout = 'C:\\code\\bin\\code.cmd\n', launchErr = null } = {}) {
  const calls = [];
  function mock(file, args, optionsOrCb, maybeCb) {
    let options;
    let cb;
    if (typeof optionsOrCb === 'function') {
      options = {};
      cb = optionsOrCb;
    } else {
      options = optionsOrCb;
      cb = maybeCb;
    }
    calls.push({ file, args, options });
    if (file === 'where' || file === 'which') {
      queueMicrotask(() => cb(null, findStdout, ''));
      return undefined;
    }
    // launch call
    queueMicrotask(() => cb(launchErr, '', launchErr ? 'boom' : ''));
    return undefined;
  }
  mock.calls = calls;
  return mock;
}

// execFile mock for openInVisualStudio: vswhere is invoked with a
// '-latest' flag (callback style, return value unused); devenv itself is
// invoked with just [target] and its return value is used as an
// EventEmitter-ish child (`.on('spawn'|'error', ...)`, `.unref()`).
function makeVSExecFileMock({ devenvPath = 'C:\\VS\\devenv.exe', spawnErr = null } = {}) {
  const calls = [];
  function mock(file, args, cb) {
    calls.push({ file, args });
    if (Array.isArray(args) && args[0] === '-latest') {
      queueMicrotask(() => cb(null, devenvPath + '\n'));
      return undefined;
    }
    const handlers = {};
    const child = {
      on(evt, handler) {
        handlers[evt] = handler;
        return child;
      },
      unref() {},
    };
    queueMicrotask(() => {
      if (spawnErr && handlers.error) handlers.error(spawnErr);
      else if (!spawnErr && handlers.spawn) handlers.spawn();
    });
    return child;
  }
  mock.calls = calls;
  return mock;
}

// --- openInVSCode: double-quote rejection -----------------------------------

test('openInVSCode rejects a cwd containing a double-quote and never reaches execFile for the launch', async () => {
  const restorePlatform = setPlatform('win32');
  try {
    const mock = makeVSCodeExecFileMock();
    const editors = loadEditorsWithExecFile(mock);
    const result = await editors.openInVSCode('C:\\some"evil\\path');
    assert.deepEqual(result, { error: 'Path contains an unsupported character (") and cannot be opened.' });
    // only the resolveVSCode 'where' lookup happened; the quote check short-
    // circuits before any launch-related execFile call.
    assert.equal(mock.calls.length, 1, 'expected exactly one execFile call (the CLI resolve), no launch attempt');
    assert.equal(mock.calls[0].file, 'where');
  } finally {
    restorePlatform();
  }
});

// --- openInVSCode: verbatim command line construction -----------------------

test('openInVSCode builds the expected verbatim cmd.exe command line for paths with & | and spaces', async () => {
  const restorePlatform = setPlatform('win32');
  try {
    const codePath = 'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd';
    const mock = makeVSCodeExecFileMock({ findStdout: codePath + '\n' });
    const editors = loadEditorsWithExecFile(mock);
    const cwd = 'C:\\R&D projects|weird & folder name';

    const result = await editors.openInVSCode(cwd);

    assert.deepEqual(result, { ok: true });
    assert.equal(mock.calls.length, 2);
    const launchCall = mock.calls[1];
    assert.equal(launchCall.file, process.env.ComSpec || 'cmd.exe');
    assert.deepEqual(launchCall.args.slice(0, 3), ['/d', '/s', '/c']);
    const expectedLine = `""${codePath}" "${cwd}""`;
    assert.equal(launchCall.args[3], expectedLine);
    assert.equal(launchCall.options.windowsVerbatimArguments, true);
    assert.equal(launchCall.options.shell, false);
  } finally {
    restorePlatform();
  }
});

// --- resolveVSCode caching ---------------------------------------------------

test('resolveVSCode caches the CLI path: a second openInVSCode call does not re-invoke where/which', async () => {
  const restorePlatform = setPlatform('win32');
  try {
    const codePath = 'C:\\code\\bin\\code.cmd';
    const mock = makeVSCodeExecFileMock({ findStdout: codePath + '\n' });
    const editors = loadEditorsWithExecFile(mock); // single module instance for both calls
    const cwd = 'C:\\plain\\path';

    const first = await editors.openInVSCode(cwd);
    const second = await editors.openInVSCode(cwd);

    assert.deepEqual(first, { ok: true });
    assert.deepEqual(second, { ok: true });
    const findCalls = mock.calls.filter((c) => c.file === 'where');
    assert.equal(findCalls.length, 1, 'where/which should only be invoked once across repeated calls');
    assert.equal(mock.calls.length, 3, 'expected 1 resolve + 2 launch calls');
  } finally {
    restorePlatform();
  }
});

// --- openInVisualStudio: non-Windows ----------------------------------------

test('openInVisualStudio on non-win32 returns an error without touching fs or execFile', async () => {
  const restorePlatform = setPlatform('linux');
  try {
    let fsTouched = false;
    await withFsMock(
      {
        existsSync: () => {
          fsTouched = true;
          return true;
        },
        readdirSync: () => {
          fsTouched = true;
          return [];
        },
      },
      async () => {
        const mock = () => {
          throw new Error('execFile must not be called when Visual Studio is unavailable on this platform');
        };
        const editors = loadEditorsWithExecFile(mock);
        const result = await editors.openInVisualStudio('/some/path');
        assert.deepEqual(result, { error: 'Visual Studio is only available on Windows.' });
      }
    );
    assert.equal(fsTouched, false, 'fs.existsSync/readdirSync must not be called on non-Windows');
  } finally {
    restorePlatform();
  }
});

// --- openInVisualStudio: .sln selection -------------------------------------

test('openInVisualStudio opens the single .sln directly when exactly one exists', async () => {
  const restorePlatform = setPlatform('win32');
  try {
    const devenvPath = 'C:\\VS\\devenv.exe';
    const mock = makeVSExecFileMock({ devenvPath });
    const editors = loadEditorsWithExecFile(mock);
    const cwd = 'C:\\repo\\worktree';

    const result = await withFsMock(
      {
        existsSync: () => true,
        readdirSync: () => ['Readme.md', 'Solution.sln'],
      },
      () => editors.openInVisualStudio(cwd)
    );

    assert.deepEqual(result, { ok: true });
    const launchCall = mock.calls.find((c) => c.file === devenvPath);
    assert.deepEqual(launchCall.args, [path.join(cwd, 'Solution.sln')]);
  } finally {
    restorePlatform();
  }
});

test('openInVisualStudio falls back to opening the folder when there are zero or multiple .sln files', async () => {
  const restorePlatform = setPlatform('win32');
  try {
    const devenvPath = 'C:\\VS\\devenv.exe';
    const cwd = 'C:\\repo\\worktree';
    const cases = [
      ['no .sln file', []],
      ['multiple .sln files', ['a.sln', 'b.sln']],
    ];
    for (const [label, files] of cases) {
      const mock = makeVSExecFileMock({ devenvPath });
      const editors = loadEditorsWithExecFile(mock);

      const result = await withFsMock(
        {
          existsSync: () => true,
          readdirSync: () => files,
        },
        () => editors.openInVisualStudio(cwd)
      );

      assert.deepEqual(result, { ok: true }, label);
      const launchCall = mock.calls.find((c) => c.file === devenvPath);
      assert.deepEqual(launchCall.args, [cwd], label);
    }
  } finally {
    restorePlatform();
  }
});
