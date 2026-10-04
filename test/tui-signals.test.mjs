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

// The notices Claude Code itself prints when a plan limit is hit. Each names
// the limit and when it resets.
test('Claude limit notices classify as rate-limited', () => {
  for (const n of [
    'Claude usage limit reached. Your limit will reset at 3pm (Europe/Brussels).',
    'Claude AI usage limit reached. Your limit will reset at 10:30pm.',
    '5-hour limit reached ∙ resets 3pm',
    'Weekly limit reached ∙ resets Mon 9am',
    'Opus weekly limit reached ∙ resets 9am',
    "You've hit your limit · resets 3pm (Europe/Brussels)",
    'You’ve hit your usage limit · resets 3pm',
  ]) {
    assert.equal(classifyOutput(n).kind, 'rate-limited', n);
  }
});

test('rate-limit extracts the reset time', () => {
  assert.equal(classifyOutput('5-hour limit reached ∙ resets 3pm').resetAt, '3pm');
  assert.equal(classifyOutput('Claude usage limit reached. Your limit will reset at 10:30pm.').resetAt, '10:30pm');
});

test('rate-limit notice split by ANSI styling and cursor moves still matches', () => {
  const styled = '[31m5-hour[1Climit[1Creached[0m ∙ [2mresets 3pm[0m';
  assert.equal(classifyOutput(styled).kind, 'rate-limited');
});

// Text that merely talks about limits (an answer, docs, this repo's own
// source and tests) must not flag the agent.
test('prose mentioning limits is not a rate limit', () => {
  for (const t of [
    '- "usage limit reached" or "rate limit reached" means rate-limited',
    'what happens when the usage limit is reached? Cover the 5-hour session limit',
    'export const RATELIMIT_RE = /(?:usage|rate)\s*limit\s*reached/i;',
    'rate limit reached',
    'Claude usage limit reached',
    'API Error: 429 rate_limit_error',
  ]) {
    assert.equal(classifyOutput(t).kind, null, t);
  }
});

test('working wins over a question in the same chunk (priority)', () => {
  // A redraw can contain both the spinner and a stale prompt line; working first.
  const both = 'Do you want to proceed?\n✶ Working… (esc to interrupt)';
  assert.equal(classifyOutput(both).kind, 'working');
});

test('rate-limit wins over a question', () => {
  const both = 'Do you want to proceed? 5-hour limit reached ∙ resets 3pm';
  assert.equal(classifyOutput(both).kind, 'rate-limited');
});
