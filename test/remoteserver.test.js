'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { loadOrCreateCert, regenerateCert, fingerprintOf } = require('../remotecert');
const { createRemoteServer } = require('../remoteserver');
const { createConnectionHandler } = require('../remoteproto');
const { createLockout, generateToken } = require('../remoteauth');
const { createRingBuffer } = require('../ringbuffer');

const quietLog = { info: () => {}, warn: () => {}, error: () => {} };

// ---- remotecert -------------------------------------------------------------

let tmp;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-remote-'));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('loadOrCreateCert creates, persists and reloads the same cert', async () => {
  const dir = path.join(tmp, 'persist');
  const a = await loadOrCreateCert(dir, { hosts: ['100.101.102.103', 'myhome.duckdns.org'] });
  assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(a.fingerprint, fingerprintOf(a.cert));
  const b = await loadOrCreateCert(dir, { hosts: ['100.101.102.103'] });
  assert.equal(b.fingerprint, a.fingerprint, 'reload must not regenerate (the phone pins it)');
  assert.equal(b.key, a.key);
});

test('generated cert is EC P-256 with the given hosts as SANs and ~10 year validity', async () => {
  const { cert } = await loadOrCreateCert(path.join(tmp, 'sans'), { hosts: ['100.101.102.103', 'myhome.duckdns.org'] });
  const x = new (require('crypto').X509Certificate)(cert);
  assert.equal(x.publicKey.asymmetricKeyType, 'ec');
  assert.match(x.subjectAltName, /IP Address:100\.101\.102\.103/);
  assert.match(x.subjectAltName, /DNS:myhome\.duckdns\.org/);
  assert.match(x.subjectAltName, /DNS:localhost/);
  const years = (new Date(x.validTo) - Date.now()) / (365 * 864e5);
  assert.ok(years > 9.9 && years < 10.1, `validity ${years}y`);
});

test('regenerateCert replaces the cert and fingerprint', async () => {
  const dir = path.join(tmp, 'regen');
  const a = await loadOrCreateCert(dir, { hosts: [] });
  const b = await regenerateCert(dir, { hosts: [] });
  assert.notEqual(b.fingerprint, a.fingerprint);
  const c = await loadOrCreateCert(dir, { hosts: [] });
  assert.equal(c.fingerprint, b.fingerprint);
});

test('a corrupt cert file is regenerated instead of crashing', async () => {
  const dir = path.join(tmp, 'corrupt');
  await loadOrCreateCert(dir, { hosts: [] });
  fs.writeFileSync(path.join(dir, 'remote-cert.pem'), 'garbage');
  const c = await loadOrCreateCert(dir, { hosts: [] });
  assert.match(c.fingerprint, /^[0-9a-f]{64}$/);
});

// ---- remoteserver (real WSS on 127.0.0.1:0) ---------------------------------

async function startServer(overrides = {}) {
  const pems = await loadOrCreateCert(path.join(tmp, `srv-${Math.random()}`), { hosts: [] });
  const token = generateToken();
  const hub = new EventEmitter();
  const buffers = new Map();
  const ptys = new Set();
  const writes = [];
  const lockout = createLockout();
  const server = createRemoteServer({
    cert: pems.cert,
    key: pems.key,
    getToken: () => token,
    lockout,
    log: quietLog,
    createHandler: ({ send, close }) =>
      createConnectionHandler({
        send,
        close,
        hub,
        hasPty: (id) => ptys.has(id),
        getBuffer: (id) => buffers.get(id) || null,
        writeInput: (id, data) => writes.push({ id, data }),
        resize: () => {},
        sizeOwner: () => 'remote',
        releaseSize: () => {},
        modePrefix: () => '',
        getAgents: () => ({ seq: 1, desktopUi: true, list: [] }),
        rpc: async () => ({}),
        log: quietLog,
      }),
    ...overrides,
  });
  const { port } = await server.listen(0, '127.0.0.1');
  const addPty = (id) => {
    ptys.add(id);
    buffers.set(id, createRingBuffer());
  };
  const emitData = (id, data) => hub.emit('data', id, buffers.get(id).append(data), data);
  return { server, port, token, pems, addPty, emitData, writes };
}

// Pinned client: trusts exactly the server's self-signed cert.
function connect(port, { token, proto = '1', ca, headers = {} } = {}) {
  const h = { ...headers };
  if (token !== undefined) h.authorization = `Bearer ${token}`;
  if (proto !== null) h['x-cc-proto'] = proto;
  return new WebSocket(`wss://127.0.0.1:${port}/`, {
    headers: h,
    ca,
    checkServerIdentity: () => undefined,
  });
}

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (d) => resolve(JSON.parse(d.toString())));
    ws.once('error', reject);
  });
}

function expectRejected(ws) {
  return new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode);
      ws.terminate();
    });
    ws.once('open', () => reject(new Error('should not open')));
    ws.once('error', () => {});
  });
}

test('a good token connects and receives the agents snapshot first', async () => {
  const { server, port, token, pems } = await startServer();
  try {
    const ws = connect(port, { token, ca: pems.cert });
    assert.deepEqual(await nextMessage(ws), { t: 'agents', seq: 1, desktopUi: true, list: [] });
    ws.close();
  } finally {
    await server.close();
  }
});

test('a bad or missing token is rejected with 401 before upgrade', async () => {
  const { server, port, pems } = await startServer();
  try {
    assert.equal(await expectRejected(connect(port, { token: generateToken(), ca: pems.cert })), 401);
    assert.equal(await expectRejected(connect(port, { ca: pems.cert })), 401);
  } finally {
    await server.close();
  }
});

test('after 5 failures the IP is locked out even with the right token', async () => {
  const { server, port, token, pems } = await startServer();
  try {
    for (let i = 0; i < 5; i++) await expectRejected(connect(port, { token: 'f'.repeat(64), ca: pems.cert }));
    assert.equal(await expectRejected(connect(port, { token, ca: pems.cert })), 401);
  } finally {
    await server.close();
  }
});

test('a protocol mismatch with a good token is rejected with 426', async () => {
  const { server, port, token, pems } = await startServer();
  try {
    assert.equal(await expectRejected(connect(port, { token, proto: '2', ca: pems.cert })), 426);
    assert.equal(await expectRejected(connect(port, { token, proto: null, ca: pems.cert })), 426);
  } finally {
    await server.close();
  }
});

test('a client pinned to a different cert fails the TLS handshake', async () => {
  const { server, port, token } = await startServer();
  const other = await loadOrCreateCert(path.join(tmp, 'other'), { hosts: [] });
  try {
    const ws = connect(port, { token, ca: other.cert });
    const err = await new Promise((resolve) => ws.once('error', resolve));
    assert.ok(err, 'expected a TLS error');
  } finally {
    await server.close();
  }
});

test('plain HTTPS requests (no upgrade) get 426', async () => {
  const { server, port, pems } = await startServer();
  try {
    const status = await new Promise((resolve, reject) => {
      https
        .get({ host: '127.0.0.1', port, path: '/', ca: pems.cert, checkServerIdentity: () => undefined }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on('error', reject);
    });
    assert.equal(status, 426);
  } finally {
    await server.close();
  }
});

test('attach replays a reset (app repaints at the new size) then streams live data in order over the wire', async () => {
  const { server, port, token, pems, addPty, emitData, writes } = await startServer();
  try {
    addPty('a1');
    emitData('a1', 'before');
    const ws = connect(port, { token, ca: pems.cert });
    await nextMessage(ws); // agents
    ws.send(JSON.stringify({ t: 'attach', id: 'a1', cols: 60, rows: 30 }));
    const replay = await nextMessage(ws);
    assert.deepEqual(replay, { t: 'replay', id: 'a1', lastSeq: 1, data: '\x1bc' });
    emitData('a1', 'after');
    assert.deepEqual(await nextMessage(ws), { t: 'data', id: 'a1', seq: 2, data: 'after' });
    ws.send(JSON.stringify({ t: 'input', id: 'a1', data: 'hi' }));
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(writes, [{ id: 'a1', data: 'hi' }]);
    ws.close();
  } finally {
    await server.close();
  }
});

test('clients() lists connections and closeAll(code) closes them with that code', async () => {
  const { server, port, token, pems } = await startServer();
  try {
    const ws = connect(port, { token, ca: pems.cert });
    await nextMessage(ws);
    const list = server.clients();
    assert.equal(list.length, 1);
    assert.match(list[0].ip, /127\.0\.0\.1/);
    assert.equal(typeof list[0].since, 'number');
    const code = new Promise((resolve) => ws.once('close', (c) => resolve(c)));
    server.closeAll(4001, 'revoked');
    assert.equal(await code, 4001);
  } finally {
    await server.close();
  }
});

test('a binary frame closes the connection with 1003', async () => {
  const { server, port, token, pems } = await startServer();
  try {
    const ws = connect(port, { token, ca: pems.cert });
    await nextMessage(ws);
    const code = new Promise((resolve) => ws.once('close', (c) => resolve(c)));
    ws.send(Buffer.from([1, 2, 3]));
    assert.equal(await code, 1003);
  } finally {
    await server.close();
  }
});

test('setSecureContext rotates the cert for new connections', async () => {
  const { server, port, token, pems } = await startServer();
  try {
    const next = await regenerateCert(path.join(tmp, 'rotate'), { hosts: [] });
    server.setSecureContext({ cert: next.cert, key: next.key });
    assert.equal(await expectRejected(connect(port, { token: 'f'.repeat(64), ca: next.cert })), 401, 'new cert accepted at TLS');
    const old = connect(port, { token, ca: pems.cert });
    const err = await new Promise((resolve) => old.once('error', resolve));
    assert.ok(err, 'old pin must fail after rotation');
  } finally {
    await server.close();
  }
});

test('a dead client is terminated by the heartbeat', async () => {
  const { server, port, token, pems } = await startServer({ heartbeatMs: 40 });
  try {
    const ws = connect(port, { token, ca: pems.cert, headers: {} });
    await nextMessage(ws);
    // Stop answering pings: ws auto-pongs, so pause the underlying socket.
    ws._socket.pause();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(server.clients().length, 0);
    ws.terminate();
  } finally {
    await server.close();
  }
});
