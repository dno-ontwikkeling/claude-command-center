import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutput } from '../renderer/tui-signals.mjs';

test('plain output is not a signal', () => {
  assert.deepEqual(classifyOutput('just some normal log output\n'), { kind: null, resetAt: null });
});

test('working spinner classifies as working', () => {
  assert.equal(classifyOutput('✶ Working… (esc to interrupt)').kind, 'working');
  assert.equal(classifyOutput('press esc to interrupt').kind, 'working');
});

test('numbered selectable prompt classifies as needs-input', () => {
  assert.equal(classifyOutput('❯ 1. Yes\n  2. No').kind, 'needs-input');
});

test('"Do you want to..." prompts classify as needs-input', () => {
  for (const q of [
    'Do you want to proceed?',
    'Do you want to continue?',
    'Do you want to create the file?',
    'Do you want to run this command?',
  ]) {
    assert.equal(classifyOutput(q).kind, 'needs-input', q);
  }
});

test('y/n prompt classifies as needs-input', () => {
  assert.equal(classifyOutput('Overwrite? (y/n)').kind, 'needs-input');
  assert.equal(classifyOutput('Continue? yes/no').kind, 'needs-input');
});

test('rate-limit notice classifies as rate-limited', () => {
  assert.equal(classifyOutput('usage limit reached').kind, 'rate-limited');
  assert.equal(classifyOutput('rate limit reached').kind, 'rate-limited');
});

test('rate-limit extracts the reset time when present', () => {
  const r = classifyOutput('limit reached — resets at 3pm');
  assert.equal(r.kind, 'rate-limited');
  assert.equal(r.resetAt, '3pm');
});

test('rate-limit extracts an HH:MM reset time', () => {
  const r = classifyOutput('usage limit reached, resets 10:30pm');
  assert.equal(r.kind, 'rate-limited');
  assert.equal(r.resetAt, '10:30pm');
});

test('rate-limit with no parseable reset time yields null resetAt', () => {
  const r = classifyOutput('usage limit reached');
  assert.equal(r.kind, 'rate-limited');
  assert.equal(r.resetAt, null);
});

test('working wins over a question in the same chunk (priority)', () => {
  // A redraw can contain both the spinner and a stale prompt line; working first.
  const both = 'Do you want to proceed?\n✶ Working… (esc to interrupt)';
  assert.equal(classifyOutput(both).kind, 'working');
});

test('rate-limit wins over a question', () => {
  const both = 'Do you want to proceed? usage limit reached';
  assert.equal(classifyOutput(both).kind, 'rate-limited');
});
