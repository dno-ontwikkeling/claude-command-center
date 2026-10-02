import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineAccumulator, wheelSequence, createVelocityTracker, momentumStep, WHEEL_LINES } from '../www/js/touch-scroll.mjs';

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

test('wheel steps cover several lines so content follows the finger', () => {
  assert.ok(WHEEL_LINES > 1);
  const acc = createLineAccumulator(10 * WHEEL_LINES);
  assert.equal(acc.move(-10), 0);
  assert.equal(acc.move(-10 * (WHEEL_LINES - 1)), 1);
});

test('wheelSequence sends SGR wheel events at the given cell, one per step', () => {
  assert.equal(wheelSequence(-2, 5, 7), '\x1b[<64;5;7M\x1b[<64;5;7M'); // up = back
  assert.equal(wheelSequence(1, 1, 1), '\x1b[<65;1;1M'); // down = forward
  assert.equal(wheelSequence(0, 1, 1), '');
});

test('wheelSequence clamps a bad cell to 1-based coordinates', () => {
  assert.equal(wheelSequence(1, 0, -3), '\x1b[<65;1;1M');
});

test('wheelSequence caps a big fling', () => {
  assert.equal(wheelSequence(500, 1, 1).length, '\x1b[<65;1;1M'.length * 50);
});

test('velocity tracker uses only the last ~100ms of movement', () => {
  const v = createVelocityTracker();
  v.add(0, 0);
  v.add(500, 100); // old, slow part (outside the window at t=700)
  v.add(600, 100);
  v.add(700, 200); // 100px in 100ms
  assert.equal(v.velocity(), 1);
});

test('velocity is 0 when the finger rested before lifting', () => {
  const v = createVelocityTracker();
  v.add(0, 0);
  v.add(50, 100);
  v.add(400, 100); // held still for 350ms
  assert.equal(v.velocity(400), 0);
});

test('momentum decays and stops', () => {
  let s = { v: 2, dy: 0 };
  let total = 0;
  let frames = 0;
  while (s && frames < 1000) {
    total += s.dy;
    s = momentumStep(s.v, 16);
    frames++;
  }
  assert.ok(frames < 300, `stops in reasonable time (${frames})`);
  assert.ok(total > 200 && total < 1000, `travels a sensible distance (${total})`);
});

test('momentum ignores slow releases', () => {
  assert.equal(momentumStep(0.01, 16), null);
});
