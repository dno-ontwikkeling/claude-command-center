'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPushNotifier } = require('../pushnotify');

const a = (id, status, dormant = false) => ({ id, label: `L${id}`, status, dormant });
const ids = (xs) => xs.map((x) => `${x.kind}:${x.id}`);

test('needs-input: notifies on entry, once, and dismisses on leaving', () => {
  const n = createPushNotifier();
  assert.deepEqual(ids(n.apply([a('a1', 'busy')]).notify), []);
  const r = n.apply([a('a1', 'needs-input')]);
  assert.deepEqual(r.notify, [{ kind: 'needs-input', id: 'a1', label: 'La1' }]);
  assert.deepEqual(n.apply([a('a1', 'needs-input')]), { notify: [], dismiss: [] });
  assert.deepEqual(ids(n.apply([a('a1', 'busy')]).dismiss), ['needs-input:a1']);
  assert.deepEqual(ids(n.apply([a('a1', 'needs-input')]).notify), ['needs-input:a1']);
});

test('needs-input: an agent that sleeps or disappears is dismissed', () => {
  const n = createPushNotifier();
  n.apply([a('a1', 'needs-input'), a('a2', 'needs-input')]);
  const r = n.apply([a('a1', 'needs-input', true)]);
  assert.deepEqual(ids(r.dismiss).sort(), ['needs-input:a1', 'needs-input:a2']);
});

test('finished: first snapshot only records; working -> done notifies', () => {
  const n = createPushNotifier();
  assert.deepEqual(n.apply([a('a1', 'done')]), { notify: [], dismiss: [] });
  n.apply([a('a1', 'busy')]);
  assert.deepEqual(ids(n.apply([a('a1', 'done')]).notify), ['finished:a1']);
  assert.deepEqual(n.apply([a('a1', 'unseen')]), { notify: [], dismiss: [] });
});

test('finished: dismissed when the agent works again', () => {
  const n = createPushNotifier();
  n.apply([a('a1', 'busy')]);
  n.apply([a('a1', 'done')]);
  assert.deepEqual(ids(n.apply([a('a1', 'busy')]).dismiss), ['finished:a1']);
});

test('needs-input to done notifies finished and dismisses the input prompt', () => {
  const n = createPushNotifier();
  n.apply([a('a1', 'busy')]);
  n.apply([a('a1', 'needs-input')]);
  const r = n.apply([a('a1', 'done')]);
  assert.deepEqual(ids(r.notify), ['finished:a1']);
  assert.deepEqual(ids(r.dismiss), ['needs-input:a1']);
});
