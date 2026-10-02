import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  attachFrame,
  detachFrame,
  inputFrame,
  resizeFrame,
  rpcFrame,
  parseServerFrame,
  createAgentsState,
  createRpcClient,
  createStream,
} from '../www/js/proto.mjs';

// Shared contract with the desktop (test/fixtures/remote-proto/).
const frames = JSON.parse(readFileSync(new URL('../../test/fixtures/remote-proto/frames.json', import.meta.url)));
const valid = frames.clientToServer.valid;

// ---- builders produce exactly the frames the desktop accepts ---------------

test('builders match the desktop-accepted fixture frames', () => {
  assert.deepEqual(attachFrame('a1', 60, 30), valid.find((f) => f.t === 'attach'));
  assert.deepEqual(detachFrame('a1'), valid.find((f) => f.t === 'detach'));
  assert.deepEqual(inputFrame('a1', 'hello\r'), valid.find((f) => f.t === 'input'));
  assert.deepEqual(resizeFrame('a1', 2, 500), valid.find((f) => f.t === 'resize'));
  for (const f of valid.filter((x) => x.t === 'rpc')) {
    assert.deepEqual(rpcFrame(f.reqId, f.method, f.args), f);
  }
});

test('builders clamp sizes into the protocol range', () => {
  assert.deepEqual(resizeFrame('a1', 1, 9999), { t: 'resize', id: 'a1', cols: 2, rows: 500 });
  assert.deepEqual(attachFrame('a1', 40.7, 20.2), { t: 'attach', id: 'a1', cols: 40, rows: 20 });
});

// ---- server frame parsing ---------------------------------------------------

for (const f of frames.serverToClient.valid) {
  test(`parseServerFrame accepts ${f.t}`, () => {
    assert.deepEqual(parseServerFrame(JSON.stringify(f)), f);
  });
}

test('parseServerFrame rejects junk and unknown types', () => {
  for (const raw of ['{nope', '[1]', '{"t":"shell"}', '{}', 'null']) {
    assert.equal(parseServerFrame(raw), null, raw);
  }
});

// ---- agents state -----------------------------------------------------------

test('agents state applies newer snapshots and drops stale ones', () => {
  const s = createAgentsState();
  const [first, second] = frames.serverToClient.valid.filter((f) => f.t === 'agents');
  assert.equal(s.apply(first), true);
  assert.equal(s.list.length, 2);
  assert.equal(s.desktopUi, true);
  assert.equal(s.apply(first), false, 'same seq again is stale');
  assert.equal(s.apply(second), true);
  assert.deepEqual(s.list, []);
  assert.equal(s.desktopUi, false);
});

test('reset() accepts a lower seq again (desktop app restarted, seq starts over)', () => {
  const s = createAgentsState();
  s.apply({ t: 'agents', seq: 50, desktopUi: true, list: [{ id: 'a1' }] });
  s.reset();
  assert.equal(s.apply({ t: 'agents', seq: 1, desktopUi: true, list: [] }), true);
  assert.deepEqual(s.list, []);
});

test('agents state finds agents by id and splits live vs dormant', () => {
  const s = createAgentsState();
  s.apply(frames.serverToClient.valid.find((f) => f.t === 'agents'));
  assert.equal(s.get('a1').status, 'busy');
  assert.equal(s.get('nope'), null);
  assert.deepEqual(s.live().map((a) => a.id), ['a1']);
  assert.deepEqual(s.dormant().map((a) => a.id), ['a2']);
});

// ---- rpc correlation --------------------------------------------------------

function fakeTimers() {
  const timers = new Map();
  let n = 0;
  return {
    setTimer: (fn) => (timers.set(++n, fn), n),
    clearTimer: (id) => timers.delete(id),
    fireAll: () => {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
    count: () => timers.size,
  };
}

test('rpc call sends a frame and resolves with the matching result', async () => {
  const sent = [];
  const t = fakeTimers();
  const rpc = createRpcClient({ send: (f) => sent.push(f), ...t });
  const p = rpc.call('spawn', { dir: 'd', cwd: 'd', cols: 60, rows: 30 });
  assert.equal(sent[0].t, 'rpc');
  assert.equal(sent[0].method, 'spawn');
  rpc.onResult({ t: 'rpc-result', reqId: sent[0].reqId, ok: true, result: { id: 'a3' } });
  assert.deepEqual(await p, { id: 'a3' });
  assert.equal(t.count(), 0, 'timer cleared');
});

test('rpc failure rejects with the server error message', async () => {
  const sent = [];
  const rpc = createRpcClient({ send: (f) => sent.push(f), ...fakeTimers() });
  const p = rpc.call('kill', { id: 'x' });
  rpc.onResult({ t: 'rpc-result', reqId: sent[0].reqId, ok: false, error: 'Unknown agent.' });
  await assert.rejects(p, /Unknown agent\./);
});

test('rpc times out', async () => {
  const t = fakeTimers();
  const rpc = createRpcClient({ send: () => {}, ...t });
  const p = rpc.call('projects.list', {});
  t.fireAll();
  await assert.rejects(p, /timed out/);
});

test('failAll rejects every pending call (connection lost)', async () => {
  const rpc = createRpcClient({ send: () => {}, ...fakeTimers() });
  const a = rpc.call('projects.list', {});
  const b = rpc.call('workspaces.list', {});
  rpc.failAll(new Error('Disconnected'));
  await assert.rejects(a, /Disconnected/);
  await assert.rejects(b, /Disconnected/);
});

test('reqIds are unique and results for unknown ids are ignored', () => {
  const sent = [];
  const rpc = createRpcClient({ send: (f) => sent.push(f), ...fakeTimers() });
  rpc.call('projects.list', {}).catch(() => {});
  rpc.call('projects.list', {}).catch(() => {});
  assert.notEqual(sent[0].reqId, sent[1].reqId);
  rpc.onResult({ t: 'rpc-result', reqId: 999, ok: true, result: null }); // no throw
});

// ---- terminal stream --------------------------------------------------------

test('stream: replay resets, then only data newer than lastSeq is written', () => {
  const s = createStream();
  assert.deepEqual(s.onReplay({ t: 'replay', id: 'a1', lastSeq: 41, data: 'X' }), { reset: true, data: 'X' });
  assert.equal(s.onData({ t: 'data', id: 'a1', seq: 41, data: 'dup' }), null);
  assert.equal(s.onData({ t: 'data', id: 'a1', seq: 42, data: 'new' }), 'new');
  assert.equal(s.onData({ t: 'data', id: 'a1', seq: 42, data: 'again' }), null);
});

test('stream: data before any replay is dropped (not attached yet)', () => {
  const s = createStream();
  assert.equal(s.onData({ t: 'data', id: 'a1', seq: 1, data: 'x' }), null);
});
