import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUserInput, buildRemoteSnapshot, snapshotChanged, createSnapshotPusher } from '../renderer/remote-sync.mjs';

const label = (x) => x.customLabel || (x.branch ? `⎇ ${x.branch}` : x.label);

test('buildRemoteSnapshot maps live and dormant agents to the wire shape', () => {
  const agents = new Map([
    ['a1', { dir: 'C:\\p', cwd: 'C:\\p', branch: 'main', label: 'Session 1', status: 'needs-input', term: {}, el: {} }],
    ['a2', { dir: 'C:\\w', cwd: 'C:\\w', branch: null, label: 'Session 1', customLabel: 'scratch', status: 'idle' }],
  ]);
  const dormant = new Map([['a3', { id: 'a3', dir: 'C:\\p', cwd: 'C:\\p\\wt', branch: 'feat', label: 'Session 2' }]]);
  assert.deepEqual(buildRemoteSnapshot(agents, dormant, label), [
    { id: 'a1', label: '⎇ main', dir: 'C:\\p', cwd: 'C:\\p', branch: 'main', status: 'needs-input', dormant: false },
    { id: 'a2', label: 'scratch', dir: 'C:\\w', cwd: 'C:\\w', branch: null, status: 'idle', dormant: false },
    { id: 'a3', label: '⎇ feat', dir: 'C:\\p', cwd: 'C:\\p\\wt', branch: 'feat', status: 'dead', dormant: true },
  ]);
});

test('buildRemoteSnapshot defaults a missing status and branch', () => {
  const agents = new Map([['a1', { dir: 'd', cwd: 'd', label: 'S' }]]);
  const [a] = buildRemoteSnapshot(agents, new Map(), label);
  assert.equal(a.status, 'busy');
  assert.equal(a.branch, null);
});

test('snapshotChanged compares by content', () => {
  const a = [{ id: 'a1', status: 'busy' }];
  assert.equal(snapshotChanged(null, a), true);
  assert.equal(snapshotChanged(a, [{ id: 'a1', status: 'busy' }]), false);
  assert.equal(snapshotChanged(a, [{ id: 'a1', status: 'idle' }]), true);
});

function fakeTimers() {
  let pending = null;
  return {
    setTimer: (fn) => (pending = fn),
    clearTimer: () => (pending = null),
    fire: () => {
      const fn = pending;
      pending = null;
      fn && fn();
    },
    pending: () => !!pending,
  };
}

test('pusher debounces bursts into one push with an incrementing seq', () => {
  const t = fakeTimers();
  let list = [{ id: 'a1', status: 'busy' }];
  const pushed = [];
  const p = createSnapshotPusher({ build: () => list, push: (s) => pushed.push(s), ...t });
  p.schedule();
  p.schedule();
  p.schedule();
  t.fire();
  assert.deepEqual(pushed, [{ seq: 1, list }]);
  list = [{ id: 'a1', status: 'idle' }];
  p.schedule();
  t.fire();
  assert.deepEqual(pushed.at(-1), { seq: 2, list });
});

test('pusher skips a push when nothing changed', () => {
  const t = fakeTimers();
  const pushed = [];
  const p = createSnapshotPusher({ build: () => [{ id: 'a1', status: 'busy' }], push: (s) => pushed.push(s), ...t });
  p.schedule();
  t.fire();
  p.schedule();
  t.fire();
  assert.equal(pushed.length, 1);
});

test('the first push happens even for an empty list', () => {
  const t = fakeTimers();
  const pushed = [];
  const p = createSnapshotPusher({ build: () => [], push: (s) => pushed.push(s), ...t });
  p.schedule();
  t.fire();
  assert.deepEqual(pushed, [{ seq: 1, list: [] }]);
});

test('isUserInput: typing and keys count, mouse and focus reports do not', () => {
  assert.equal(isUserInput('a'), true);
  assert.equal(isUserInput('\r'), true);
  assert.equal(isUserInput('\x1b[A'), true); // arrow key
  assert.equal(isUserInput('\x1b'), true); // Esc
  assert.equal(isUserInput('\x1b[<35;12;7M'), false); // SGR mouse motion (?1003)
  assert.equal(isUserInput('\x1b[<0;1;1M\x1b[<0;1;1m'), false); // SGR click
  assert.equal(isUserInput('\x1b[M !!'), false); // legacy X10 mouse
  assert.equal(isUserInput('\x1b[I'), false); // focus in (?1004)
  assert.equal(isUserInput('\x1b[O'), false); // focus out
  assert.equal(isUserInput('\x1b[Ix'), true); // focus report plus a real key
  assert.equal(isUserInput(''), false);
});
