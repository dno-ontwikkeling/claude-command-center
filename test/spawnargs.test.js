'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildClaudeArgs, MAX_PROMPT } = require('../spawnargs');

test('no options → no args', () => {
  assert.deepEqual(buildClaudeArgs({}), []);
  assert.deepEqual(buildClaudeArgs(), []);
});

test('resume, then bypass, in that order', () => {
  assert.deepEqual(buildClaudeArgs({ resume: 'abc', bypass: true }), ['--resume', 'abc', '--dangerously-skip-permissions']);
});

test('the prompt is the last positional, after bypass', () => {
  assert.deepEqual(buildClaudeArgs({ bypass: true, prompt: '/x:y do it' }), ['--dangerously-skip-permissions', '/x:y do it']);
});

test('a prompt is never combined with resume', () => {
  assert.deepEqual(buildClaudeArgs({ resume: 'abc', prompt: 'hello' }), ['--resume', 'abc']);
});

test('an empty or non-string prompt adds nothing', () => {
  assert.deepEqual(buildClaudeArgs({ prompt: '' }), []);
  assert.deepEqual(buildClaudeArgs({ prompt: null }), []);
  assert.deepEqual(buildClaudeArgs({ prompt: 42 }), []);
});

test('a prompt with a NUL character is rejected', () => {
  assert.throws(() => buildClaudeArgs({ prompt: 'a\0b' }), /NUL/);
});

test('a prompt over the cap is rejected', () => {
  assert.equal(MAX_PROMPT, 8000);
  assert.doesNotThrow(() => buildClaudeArgs({ prompt: 'x'.repeat(MAX_PROMPT) }));
  assert.throws(() => buildClaudeArgs({ prompt: 'x'.repeat(MAX_PROMPT + 1) }), /8000|too long/);
});

test('newlines, quotes, backslashes and non-ASCII pass through unchanged', () => {
  const p = '/skill brief\nline "two" \\" é 中文 \\';
  assert.deepEqual(buildClaudeArgs({ prompt: p }), [p]);
});

test('a quote-wrapped prompt with whitespace gets a trailing space (node-pty quirk, Step 1)', () => {
  assert.deepEqual(buildClaudeArgs({ prompt: '"a b"' }), ['"a b" ']);
  assert.deepEqual(buildClaudeArgs({ prompt: '"a\nb"' }), ['"a\nb" ']);
  // no whitespace, or not wrapped on both ends → unchanged
  assert.deepEqual(buildClaudeArgs({ prompt: '"ab"' }), ['"ab"']);
  assert.deepEqual(buildClaudeArgs({ prompt: '"a b' }), ['"a b']);
});

test('a prompt that starts with "-" gets a leading space so claude does not read it as an option', () => {
  assert.deepEqual(buildClaudeArgs({ prompt: '--help me' }), [' --help me']);
});
