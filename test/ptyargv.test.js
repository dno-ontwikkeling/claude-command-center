'use strict';

// Spike (plan claude-code-steering, Step 1): does a long first prompt survive
// being passed as a command-line argument through @lydell/node-pty, the way
// spawnAgent passes args to claude? node-pty builds the Windows command line
// itself (argsToCommandLine), so quoting of quotes, backslashes and newlines
// is what is under test here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURE = path.join(__dirname, 'fixtures', 'argv-echo.js');

function buildPrompt() {
  const pieces = [
    '/workflow:work plans/x.md',
    'line two\nline three\r\nline four',
    'say "hello" and "quoted words with spaces"',
    'backslash before quote \\" and double \\\\" here',
    'trailing backslash in middle \\ ok',
    'percent %PATH% and %% and caret ^ and ^^ and amp & and && pipe | lt < gt >',
    'non-ASCII: é ü ñ 中文 日本語 emoji 🚀 ✓ →',
    "single 'quotes' and `backticks` and $VAR and !bang",
    '\ttab\tseparated\t',
  ];
  let s = pieces.join('\n');
  while (s.length < 7900) s += '\n' + pieces[s.length % pieces.length];
  s = s.slice(0, 7990);
  return s + ' end\\'; // trailing backslash at the very end
}

function runThroughPty(arg) {
  const pty = require('@lydell/node-pty');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ptyargv-'));
  const out = path.join(dir, 'argv.txt');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pty child did not exit')), 15000);
    const term = pty.spawn(process.execPath, [FIXTURE, arg], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: dir,
      env: { ...process.env, ARGV_OUT: out },
    });
    term.onData(() => {});
    term.onExit(({ exitCode }) => {
      clearTimeout(timer);
      // ConPTY handles keep the event loop alive after the child exits;
      // kill() releases them (its console-list helper may print a harmless
      // "AttachConsole failed" because the child is already gone).
      try { term.kill(); } catch { /* already gone */ }
      try {
        const got = fs.readFileSync(out, 'utf8');
        resolve({ exitCode, got });
      } catch (err) {
        reject(err);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

test('a long prompt with quotes, backslashes, newlines and non-ASCII survives node-pty argv', { skip: process.platform !== 'win32' && 'Windows-only spike' }, async () => {
  const prompt = buildPrompt();
  assert.ok(prompt.length >= 7900 && prompt.length <= 8000, `prompt length ${prompt.length}`);
  const { exitCode, got } = await runThroughPty(prompt);
  assert.equal(exitCode, 0);
  assert.equal(got.length, prompt.length);
  assert.equal(got, prompt);
});

test('a quote-wrapped prompt with a space survives once a trailing space breaks the quote wrap', { skip: process.platform !== 'win32' && 'Windows-only spike' }, async () => {
  // argsToCommandLine passes an arg that starts and ends with `"` and
  // contains a space through unquoted (winpty quirk), so
  // '"quoted start and end"' arrives as '"quoted'. Appending a space means
  // the arg no longer ends with `"`, and it is quoted normally.
  // spawnargs.buildClaudeArgs (Step 7) applies this.
  const prompt = '"quoted start and end" ';
  const { got } = await runThroughPty(prompt);
  assert.equal(got, prompt);
});
