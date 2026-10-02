import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBlocks, isNearBottom } from '../www/js/history-model.mjs';

test('plain text is one prose block', () => {
  assert.deepEqual(splitBlocks('hello\nworld'), [{ code: false, text: 'hello\nworld' }]);
});

test('fenced code becomes its own block, language line dropped', () => {
  assert.deepEqual(splitBlocks('Run:\n```bash\nnpm test\n```\nDone.'), [
    { code: false, text: 'Run:' },
    { code: true, text: 'npm test' },
    { code: false, text: 'Done.' },
  ]);
});

test('an unclosed fence (truncated reply) still renders as code', () => {
  assert.deepEqual(splitBlocks('x\n```\nabc'), [
    { code: false, text: 'x' },
    { code: true, text: 'abc' },
  ]);
});

test('empty input gives no blocks', () => {
  assert.deepEqual(splitBlocks(''), []);
});

test('isNearBottom allows a small slack', () => {
  assert.equal(isNearBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 }), true);
  assert.equal(isNearBottom({ scrollTop: 860, clientHeight: 100, scrollHeight: 1000 }), true);
  assert.equal(isNearBottom({ scrollTop: 500, clientHeight: 100, scrollHeight: 1000 }), false);
});
