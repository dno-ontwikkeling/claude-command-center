'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTranscript, toolSummary, isSessionId } = require('../transcript');

const line = (o) => JSON.stringify(o);
const user = (content, extra = {}) => line({ type: 'user', message: { role: 'user', content }, timestamp: 't', ...extra });
const assistant = (content, extra = {}) =>
  line({ type: 'assistant', message: { role: 'assistant', content }, timestamp: 't', ...extra });

test('keeps prompts, replies and tool calls; drops thinking, tool results and bookkeeping', () => {
  const text = [
    line({ type: 'mode', mode: 'x' }),
    user('Fix the bug'),
    assistant([{ type: 'thinking', thinking: 'hmm' }]),
    assistant([{ type: 'tool_use', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }]),
    user([{ type: 'tool_result', content: 'ok', tool_use_id: 'x' }]),
    assistant([{ type: 'text', text: 'All green.' }]),
    line({ type: 'attachment', attachment: {} }),
  ].join('\n');
  assert.deepEqual(
    parseTranscript(text).map(({ k, t, name }) => ({ k, t, name })),
    [
      { k: 'user', t: 'Fix the bug', name: undefined },
      { k: 'tool', t: 'Run tests', name: 'Bash' },
      { k: 'text', t: 'All green.', name: undefined },
    ],
  );
});

test('skips sidechain (subagent) and meta lines, system reminders and local command output', () => {
  const text = [
    user('real prompt'),
    user('subagent prompt', { isSidechain: true }),
    user('meta', { isMeta: true }),
    user('<local-command-stdout>Reloaded</local-command-stdout>'),
    user([{ type: 'text', text: '<system-reminder>noise</system-reminder>' }]),
  ].join('\n');
  assert.deepEqual(
    parseTranscript(text).map((e) => e.t),
    ['real prompt'],
  );
});

test('a slash command shows as /name args', () => {
  const text = user('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep it short</command-args>');
  assert.deepEqual(parseTranscript(text)[0], { k: 'user', t: '/compact keep it short', ts: 't' });
});

test('tolerates broken lines', () => {
  const text = ['{not json', user('hi'), '', 'null'].join('\n');
  assert.deepEqual(
    parseTranscript(text).map((e) => e.t),
    ['hi'],
  );
});

test('keeps the newest entries within maxEntries and truncates long text', () => {
  const lines = [];
  for (let i = 0; i < 10; i++) lines.push(user(`p${i}`));
  lines.push(assistant([{ type: 'text', text: 'x'.repeat(50) }]));
  const out = parseTranscript(lines.join('\n'), { maxEntries: 3, maxChars: 10 });
  assert.deepEqual(
    out.map((e) => e.t),
    ['p8', 'p9', 'xxxxxxxxxx…'],
  );
});

test('stays under the byte budget by dropping the oldest entries', () => {
  const lines = [];
  for (let i = 0; i < 20; i++) lines.push(user(`${i}`.padEnd(100, '.')));
  const out = parseTranscript(lines.join('\n'), { maxBytes: 1000 });
  assert.ok(JSON.stringify(out).length <= 1000);
  assert.equal(out.at(-1).t.slice(0, 2), '19');
});

test('toolSummary picks the most useful field per tool', () => {
  assert.equal(toolSummary('Bash', { command: 'ls -la\nmore', description: 'List files' }), 'List files');
  assert.equal(toolSummary('Bash', { command: 'ls -la\nmore' }), 'ls -la');
  assert.equal(toolSummary('Read', { file_path: 'C:\\repo\\src\\main.js' }), 'main.js');
  assert.equal(toolSummary('Edit', { file_path: '/repo/a/b.ts' }), 'b.ts');
  assert.equal(toolSummary('Grep', { pattern: 'foo.*bar' }), 'foo.*bar');
  assert.equal(toolSummary('Agent', { description: 'Find callers', prompt: 'long' }), 'Find callers');
  assert.equal(toolSummary('mcp__x__y', { url: 'https://a.b' }), 'https://a.b');
  assert.equal(toolSummary('Nothing', {}), '');
});

test('isSessionId only accepts a UUID (no path tricks)', () => {
  assert.equal(isSessionId('e3a675c1-d1fd-42b9-b07b-1ebf37c7447f'), true);
  assert.equal(isSessionId('../../etc/passwd'), false);
  assert.equal(isSessionId('e3a675c1-d1fd-42b9-b07b-1ebf37c7447f/../x'), false);
  assert.equal(isSessionId(null), false);
});
