'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
const { parseClientFrame, createConnectionHandler, createSizeTracker, createModeTracker } = require('../remoteproto');
const { createRingBuffer } = require('../ringbuffer');

const frames = require(path.join(__dirname, 'fixtures', 'remote-proto', 'frames.json'));

// ---- validation (shared fixtures) -----------------------------------------

for (const f of frames.clientToServer.valid) {
  test(`parseClientFrame accepts ${f.t}${f.method ? ' ' + f.method : ''} ${JSON.stringify(f.args || '')}`, () => {
    const r = parseClientFrame(JSON.stringify(f));
    assert.equal(r.ok, true, r.why);
    assert.deepEqual(r.frame, f);
  });
}

for (const inv of frames.clientToServer.invalid) {
  test(`parseClientFrame rejects: ${inv.why}`, () => {
    let raw = inv.raw;
    if (raw === undefined) {
      const frame = { ...inv.frame };
      if (inv.dataLength) frame.data = 'x'.repeat(inv.dataLength);
      raw = JSON.stringify(frame);
    }
    const r = parseClientFrame(raw);
    assert.equal(r.ok, false);
    assert.ok(r.why);
  });
}

test('parseClientFrame accepts input exactly at the limit', () => {
  const r = parseClientFrame(JSON.stringify({ t: 'input', id: 'a1', data: 'x'.repeat(frames.limits.maxInputChars) }));
  assert.equal(r.ok, true);
});

// ---- size tracker ---------------------------------------------------------

test('size tracker resizes only when the size changes, and tracks the owner', () => {
  const st = createSizeTracker();
  assert.equal(st.request('a1', 'desktop', 120, 40), true);
  assert.equal(st.owner('a1'), 'desktop');
  assert.equal(st.request('a1', 'desktop', 120, 40), false);
  assert.equal(st.request('a1', 'remote', 60, 30), true);
  assert.equal(st.owner('a1'), 'remote');
  // owner flips back but the size happens to match: owner changes, no resize
  assert.equal(st.request('a1', 'desktop', 60, 30), false);
  assert.equal(st.owner('a1'), 'desktop');
  st.forget('a1');
  assert.equal(st.owner('a1'), null);
});

// ---- connection handler ---------------------------------------------------

function setup({ agents = { seq: 1, desktopUi: true, list: [] }, rpc, modePrefix, takeover } = {}) {
  const hub = new EventEmitter();
  const buffers = new Map();
  const sent = [];
  const closed = [];
  const writes = [];
  const resizes = [];
  const owners = new Map();
  const takeovers = [];
  const pushed = [];
  const ptys = new Set();
  const addPty = (id) => {
    ptys.add(id);
    buffers.set(id, createRingBuffer({ cap: 1000 }));
  };
  // Mirrors what main does on pty output: append to the buffer, then publish.
  const emitData = (id, data) => hub.emit('data', id, buffers.get(id).append(data), data);
  const h = createConnectionHandler({
    send: (obj) => sent.push(obj),
    close: (code, reason) => closed.push({ code, reason }),
    hub,
    hasPty: (id) => ptys.has(id),
    getBuffer: (id) => buffers.get(id) || null,
    writeInput: (id, data) => writes.push({ id, data }),
    resize: (id, cols, rows, owner, opts) => {
      owners.set(id, owner);
      resizes.push({ id, cols, rows, owner, ...opts });
    },
    sizeOwner: (id) => owners.get(id) || null,
    // Default: no resumable session, so no restart (sync false).
    takeover: (id, cols, rows) => {
      takeovers.push({ id, cols, rows });
      return takeover ? takeover(id, cols, rows, { owners, buffers }) : false;
    },
    modePrefix: modePrefix || (() => ''),
    getAgents: () => agents,
    registerPush: (token) => pushed.push(token),
    rpc: rpc || (async () => ({})),
    log: { warn: () => {}, info: () => {} },
  });
  return { h, hub, sent, closed, writes, resizes, owners, takeovers, pushed, addPty, emitData };
}

const tick = () => new Promise((r) => setImmediate(r));

test('sends the current agents snapshot on connect', () => {
  const agents = { seq: 3, desktopUi: true, list: [{ id: 'a1', status: 'busy' }] };
  const { sent } = setup({ agents });
  assert.deepEqual(sent[0], { t: 'agents', ...agents });
});

test('forwards agents snapshots published on the hub', () => {
  const { hub, sent } = setup();
  hub.emit('agents', { seq: 9, desktopUi: false, list: [] });
  assert.deepEqual(sent.at(-1), { t: 'agents', seq: 9, desktopUi: false, list: [] });
});

test('a malformed frame closes the connection with 1008', () => {
  const { h, closed } = setup();
  h.onMessage('{nope');
  assert.deepEqual(closed, [{ code: 1008, reason: 'invalid frame' }]);
});

test('frames after close are ignored', () => {
  const { h, writes, addPty } = setup();
  addPty('a1');
  h.onMessage('{nope');
  h.onMessage(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
  h.onMessage(JSON.stringify({ t: 'input', id: 'a1', data: 'x' }));
  assert.equal(writes.length, 0);
});

test('attach without a resumable session: forced repaint, replays only a reset, then newer data', () => {
  // Old output was drawn at the desktop's width: replaying it into the phone's
  // narrower terminal fills its scrollback with garbage. With no session to
  // restart, the app repaints at the phone's size instead.
  const { h, sent, resizes, addPty, emitData } = setup();
  addPty('a1');
  emitData('a1', 'old1');
  emitData('a1', 'old2');
  h.onMessage(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
  assert.deepEqual(resizes, [{ id: 'a1', cols: 60, rows: 30, owner: 'remote', repaint: true }]);
  const replay = sent.find((m) => m.t === 'replay');
  assert.deepEqual(replay, { t: 'replay', id: 'a1', lastSeq: 2, data: '\x1bc' });
  emitData('a1', 'new');
  assert.deepEqual(sent.at(-1), { t: 'data', id: 'a1', seq: 3, data: 'new' });
});

test('data for agents not attached is not sent', () => {
  const { sent, addPty, emitData } = setup();
  addPty('a1');
  const before = sent.length;
  emitData('a1', 'x');
  assert.equal(sent.length, before);
});

test('live data with seq <= replay lastSeq is dropped (no duplicates)', () => {
  const { h, hub, sent, addPty, emitData } = setup();
  addPty('a1');
  emitData('a1', 'a');
  h.onMessage(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
  hub.emit('data', 'a1', 1, 'a'); // stale re-delivery
  assert.equal(sent.filter((m) => m.t === 'data').length, 0);
});

test('attach to an agent with no live pty reports exit instead of replay', () => {
  const { h, sent } = setup();
  h.onMessage(JSON.stringify({ t: 'attach', id: 'ghost', cols: 60, rows: 30 }));
  assert.deepEqual(sent.at(-1), { t: 'exit', id: 'ghost', exitCode: null, error: 'Agent is not running.' });
});

test('detach stops streaming', () => {
  const { h, sent, addPty, emitData } = setup();
  addPty('a1');
  h.onMessage(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
  h.onMessage(JSON.stringify({ t: 'detach', id: 'a1' }));
  emitData('a1', 'x');
  assert.equal(sent.filter((m) => m.t === 'data').length, 0);
});

test('input reaches the pty only for attached agents', () => {
  const { h, writes, addPty } = setup();
  addPty('a1');
  addPty('a2');
  h.onMessage(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
  h.onMessage(JSON.stringify({ t: 'input', id: 'a1', data: 'hi' }));
  h.onMessage(JSON.stringify({ t: 'input', id: 'a2', data: 'nope' }));
  assert.deepEqual(writes, [{ id: 'a1', data: 'hi' }]);
});

test('typing is ignored while the desktop has control (the phone shows Take over)', () => {
  const { h, writes, owners, addPty } = setup();
  addPty('a1');
  h.onMessage(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
  owners.set('a1', 'desktop'); // the desktop took over
  h.onMessage(JSON.stringify({ t: 'input', id: 'a1', data: 'x' }));
  assert.deepEqual(writes, []);
});

test('attach while the desktop has control hands over (restart) and replays the fresh buffer', async () => {
  const { h, sent, resizes, takeovers, addPty, emitData } = setup({
    // The restart: a new pty (fresh buffer) at the phone's size, phone owns it.
    takeover: async (id, cols, rows, { owners, buffers }) => {
      buffers.set(id, createRingBuffer({ cap: 1000 }));
      owners.set(id, 'remote');
      emitData(id, 'conversation at 60 cols');
      return true;
    },
  });
  addPty('a1');
  emitData('a1', 'old desktop-width output');
  h.onMessage(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
  await tick();
  assert.deepEqual(takeovers, [{ id: 'a1', cols: 60, rows: 30 }]);
  assert.deepEqual(resizes, [], 'the restart already started at the phone size');
  const replay = sent.find((m) => m.t === 'replay');
  assert.deepEqual(replay, { t: 'replay', id: 'a1', lastSeq: 1, data: '\x1bcconversation at 60 cols' });
  emitData('a1', 'live');
  assert.deepEqual(sent.at(-1), { t: 'data', id: 'a1', seq: 2, data: 'live' });
});

test('attach while the phone already has control replays its buffer without a restart', () => {
  const { h, sent, takeovers, owners, addPty, emitData } = setup();
  addPty('a1');
  owners.set('a1', 'remote');
  emitData('a1', 'drawn at phone width');
  h.onMessage(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
  assert.deepEqual(takeovers, []);
  assert.equal(sent.find((m) => m.t === 'replay').data, '\x1bcdrawn at phone width');
});

test('resize updates the remembered phone size and resizes', () => {
  const { h, resizes, addPty } = setup();
  addPty('a1');
  h.onMessage(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
  h.onMessage(JSON.stringify({ t: 'resize', id: 'a1', cols: 40, rows: 20 }));
  assert.deepEqual(resizes.at(-1), { id: 'a1', cols: 40, rows: 20, owner: 'remote' });
});

test('exit of an attached agent is forwarded and detaches it', () => {
  const { h, hub, sent, writes, addPty } = setup();
  addPty('a1');
  h.onMessage(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
  hub.emit('exit', 'a1', { exitCode: 0 });
  assert.deepEqual(sent.at(-1), { t: 'exit', id: 'a1', exitCode: 0 });
  h.onMessage(JSON.stringify({ t: 'input', id: 'a1', data: 'x' }));
  assert.equal(writes.length, 0);
});

test('rpc success and failure map to rpc-result frames', async () => {
  const { h, sent } = setup({
    rpc: async (method, args) => {
      if (method === 'kill') throw new Error('Unknown agent.');
      return { method, args };
    },
  });
  h.onMessage(JSON.stringify({ t: 'rpc', reqId: 1, method: 'projects.list', args: {} }));
  h.onMessage(JSON.stringify({ t: 'rpc', reqId: 2, method: 'kill', args: { id: 'zz' } }));
  await tick();
  assert.deepEqual(sent.find((m) => m.reqId === 1), {
    t: 'rpc-result', reqId: 1, ok: true, result: { method: 'projects.list', args: {} },
  });
  assert.deepEqual(sent.find((m) => m.reqId === 2), { t: 'rpc-result', reqId: 2, ok: false, error: 'Unknown agent.' });
});

test('an rpc that resolves after close sends nothing', async () => {
  let resolve;
  const { h, sent } = setup({ rpc: () => new Promise((r) => (resolve = r)) });
  h.onMessage(JSON.stringify({ t: 'rpc', reqId: 1, method: 'projects.list', args: {} }));
  h.onClose();
  const before = sent.length;
  resolve({});
  await tick();
  assert.equal(sent.length, before);
});

test('onClose unsubscribes from the hub', () => {
  const { h, hub } = setup();
  h.onClose();
  assert.equal(hub.listenerCount('data') + hub.listenerCount('exit') + hub.listenerCount('agents'), 0);
});

test('transcript rpc needs an agent id', () => {
  assert.equal(parseClientFrame(JSON.stringify({ t: 'rpc', reqId: 1, method: 'transcript', args: { id: 'a1' } })).ok, true);
  assert.equal(parseClientFrame(JSON.stringify({ t: 'rpc', reqId: 1, method: 'transcript', args: {} })).ok, false);
});

test('mode tracker remembers DEC private modes the app switched on', () => {
  const m = createModeTracker();
  m.feed('\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?2004h');
  m.feed('\x1b[?1002l'); // switched off again
  assert.equal(m.prefix(), '\x1b[?1049h\x1b[?1000h\x1b[?1003h\x1b[?1006h\x1b[?2004h');
});

test('mode tracker handles combined params and sequences split across chunks', () => {
  const m = createModeTracker();
  m.feed('text\x1b[?10');
  m.feed('49;1006h more');
  assert.equal(m.prefix(), '\x1b[?1049h\x1b[?1006h');
});

test('mode tracker ignores modes outside the replay list (cursor, etc.)', () => {
  const m = createModeTracker();
  m.feed('\x1b[?25l\x1b[?12h');
  assert.equal(m.prefix(), '');
});

test('attach replays the tracked modes right after the reset', () => {
  const { h, sent, addPty, emitData } = setup({ modePrefix: () => '\x1b[?1049h\x1b[?1003h' });
  addPty('a1');
  emitData('a1', 'screen');
  h.onMessage(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
  const replay = sent.find((m) => m.t === 'replay');
  assert.equal(replay.data, '\x1bc\x1b[?1049h\x1b[?1003h');
});

test('agent management and folder rpcs validate their args', () => {
  const ok = (method, args) => parseClientFrame(JSON.stringify({ t: 'rpc', reqId: 1, method, args })).ok;
  assert.equal(ok('agent.rename', { id: 'a1', name: 'my agent' }), true);
  assert.equal(ok('agent.rename', { id: 'a1', name: '' }), false);
  assert.equal(ok('agent.rename', { id: 'a1', name: 'x'.repeat(81) }), false);
  assert.equal(ok('agent.rename', { id: 'a1', name: 'bad\nname' }), false);
  assert.equal(ok('agent.forget', { id: 'a1' }), true);
  assert.equal(ok('agent.forget', { id: 'a1', deleteWorktree: true, deleteBranch: false, force: false }), true);
  assert.equal(ok('agent.forget', { id: 'a1', deleteWorktree: 'yes' }), false);
  assert.equal(ok('worktree.delete', { id: 'a1', deleteBranch: true, force: false }), false, 'replaced by agent.forget');
  assert.equal(ok('fs.list', {}), true);
  assert.equal(ok('fs.list', { path: 'C:\\Projects' }), true);
  assert.equal(ok('fs.list', { path: 42 }), false);
  assert.equal(ok('project.add', { dir: 'C:\\Projects\\x' }), true);
  assert.equal(ok('project.add', {}), false);
  assert.equal(ok('workspace.create', { parent: 'C:\\ws', name: 'scratch', useParent: false }), true);
  assert.equal(ok('workspace.create', { parent: 'C:\\ws', useParent: true }), true);
  assert.equal(ok('workspace.create', { parent: 'C:\\ws', name: 7, useParent: false }), false);
});

test('push-register hands the phone token to the host', () => {
  const { h, pushed } = setup();
  h.onMessage(JSON.stringify({ t: 'push-register', token: 'abc:APA91b-_x.yzabcdefghijkl' }));
  assert.deepEqual(pushed, ['abc:APA91b-_x.yzabcdefghijkl']);
});
