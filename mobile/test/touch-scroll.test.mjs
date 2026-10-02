import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineAccumulator, wheelSequence } from '../www/js/touch-scroll.mjs';

test('finger moving up scrolls forward by whole lines, keeps the remainder', () => {
  const acc = createLineAccumulator(20);
  assert.equal(acc.move(-15), 0);
  assert.equal(acc.move(-15), 1); // 30px: one line, 10px carried
  assert.equal(acc.move(-30), 2); // 40px total carried
});

test('finger moving down scrolls back', () => {
  const acc = createLineAccumulator(10);
  assert.equal(acc.move(35), -3);
  assert.equal(acc.move(5), -1); // 5 carried + 5
});

test('reset drops the carried remainder', () => {
  const acc = createLineAccumulator(20);
  acc.move(-19);
  acc.reset();
  assert.equal(acc.move(-19), 0);
});

test('a bad line height never divides by zero', () => {
  const acc = createLineAccumulator(0);
  assert.equal(acc.move(-5), 5);
});

test('wheelSequence sends SGR wheel events, one per line', () => {
  assert.equal(wheelSequence(-2), '\x1b[<64;1;1M\x1b[<64;1;1M'); // up = back
  assert.equal(wheelSequence(1), '\x1b[<65;1;1M'); // down = forward
  assert.equal(wheelSequence(0), '');
});

test('wheelSequence caps a big fling', () => {
  assert.equal(wheelSequence(500).length, '\x1b[<65;1;1M'.length * 50);
});
