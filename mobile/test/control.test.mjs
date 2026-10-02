import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControlTracker } from '../www/js/control.mjs';

test('control is "lost" only after the phone had it (a stale snapshot right after attach is ignored)', () => {
  const c = createControlTracker();
  assert.equal(c.update(false), 'pending'); // snapshot from before the takeover
  assert.equal(c.update(true), 'have');
  assert.equal(c.update(true), 'have');
  assert.equal(c.update(false), 'lost'); // the desktop took over
  assert.equal(c.update(false), 'pending', 'reported once');
});

test('reset starts over (taking control again)', () => {
  const c = createControlTracker();
  c.update(true);
  c.reset();
  assert.equal(c.update(false), 'pending');
});
