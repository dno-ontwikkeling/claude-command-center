'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createRequestHandler } = require('../hookserver');
const { agentSecret } = require('../hookauth');

const MASTER = 'cafebabe'.repeat(8);

// Spin up a real http server around the extracted handler, bound to an
// ephemeral port on loopback. Returns { url, events, close } — `events`
// collects every payload the handler forwarded via sendToRenderer.
function startTestServer(overrides = {}) {
  const agents = overrides.agents || new Map([['agent-1', {}]]);
  const events = [];
  const handler = createRequestHandler({
    agents,
    agentSecret: overrides.agentSecretFn || ((id) => agentSecret(MASTER, id)),
    sendToRenderer: (channel, payload) => events.push({ channel, payload }),
    log: { warn: () => {}, error: () => {} },
  });
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/event`,
        events,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Raw http.request wrapper so we can send arbitrary/oversized/malformed bodies
// (fetch would happily buffer these too, but this keeps control explicit and
// mirrors what a hook script actually does).
function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('200: valid agentId + matching token reaches the renderer', async () => {
  const { url, events, close } = await startTestServer();
  const token = agentSecret(MASTER, 'agent-1');
  const res = await post(url, JSON.stringify({ agentId: 'agent-1', hook: 'Stop' }), {
    'x-cc-secret': token,
    'content-type': 'application/json',
  });
  assert.equal(res.status, 200);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    channel: 'agent:event',
    payload: { agentId: 'agent-1', hook: 'Stop' },
  });
  await close();
});

test('404: unknown agentId is rejected before the token is even checked', async () => {
  const { url, events, close } = await startTestServer();
  const token = agentSecret(MASTER, 'ghost-agent');
  const res = await post(url, JSON.stringify({ agentId: 'ghost-agent' }), {
    'x-cc-secret': token,
  });
  assert.equal(res.status, 404);
  assert.equal(events.length, 0);
  await close();
});

test('404: missing agentId in the body is rejected', async () => {
  const { url, events, close } = await startTestServer();
  const res = await post(url, JSON.stringify({ hook: 'Stop' }), {});
  assert.equal(res.status, 404);
  assert.equal(events.length, 0);
  await close();
});

test('404: unknown route/method never reaches the body parser', async () => {
  const { url, close } = await startTestServer();
  const res = await post(url.replace('/event', '/nope'), '{}', {});
  assert.equal(res.status, 404);
  const getRes = await new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET' }, (res2) => resolve({ status: res2.statusCode }));
    req.on('error', reject);
    req.end();
  });
  assert.equal(getRes.status, 404);
  await close();
});

test('403: known agentId with a wrong token is rejected', async () => {
  const { url, events, close } = await startTestServer();
  const res = await post(url, JSON.stringify({ agentId: 'agent-1' }), {
    'x-cc-secret': agentSecret(MASTER, 'some-other-agent'),
  });
  assert.equal(res.status, 403);
  assert.equal(events.length, 0);
  await close();
});

test('403: known agentId with a missing token is rejected', async () => {
  const { url, events, close } = await startTestServer();
  const res = await post(url, JSON.stringify({ agentId: 'agent-1' }), {});
  assert.equal(res.status, 403);
  assert.equal(events.length, 0);
  await close();
});

test('400: malformed JSON body is rejected', async () => {
  const { url, events, close } = await startTestServer();
  const res = await post(url, '{ not json ', {
    'x-cc-secret': agentSecret(MASTER, 'agent-1'),
  });
  assert.equal(res.status, 400);
  assert.equal(events.length, 0);
  await close();
});

test('413: an oversized body (>64KB) is rejected and never reaches JSON.parse', async () => {
  const { url, events, close } = await startTestServer();
  // Valid JSON shape, but padded well past the 64KB cutoff.
  const big = JSON.stringify({ agentId: 'agent-1', pad: 'x'.repeat(70 * 1024) });
  const res = await post(url, big, {
    'x-cc-secret': agentSecret(MASTER, 'agent-1'),
    'content-type': 'application/json',
  });
  assert.equal(res.status, 413);
  assert.equal(events.length, 0);
  await close();
});

test('a body just under the 64KB cutoff with valid auth still succeeds (boundary sanity check)', async () => {
  const { url, events, close } = await startTestServer();
  const pad = 'x'.repeat(60 * 1024);
  const res = await post(url, JSON.stringify({ agentId: 'agent-1', pad }), {
    'x-cc-secret': agentSecret(MASTER, 'agent-1'),
  });
  assert.equal(res.status, 200);
  assert.equal(events.length, 1);
  await close();
});

// ---- POST /command ---------------------------------------------------------

function startCommandServer({ runCommand, socketTimeout, agents } = {}) {
  const logs = [];
  const log = {
    info: (...a) => logs.push(['info', ...a]),
    warn: (...a) => logs.push(['warn', ...a]),
    error: (...a) => logs.push(['error', ...a]),
  };
  const handler = createRequestHandler({
    agents: agents || new Map([['agent-1', {}]]),
    agentSecret: (id) => agentSecret(MASTER, id),
    sendToRenderer: () => {},
    runCommand: runCommand || (async (id, op, args) => ({ id, op, args })),
    log,
  });
  const server = http.createServer(handler);
  if (socketTimeout) server.setTimeout(socketTimeout);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ port, url: `http://127.0.0.1:${port}/command`, logs, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const cmdHeaders = (id = 'agent-1') => ({ 'x-cc-secret': agentSecret(MASTER, id), 'content-type': 'application/json' });

test('/command: 200 with the runner result for a valid caller', async () => {
  const s = await startCommandServer();
  try {
    const res = await post(s.url, JSON.stringify({ agentId: 'agent-1', op: 'config', args: {} }), cmdHeaders());
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, result: { id: 'agent-1', op: 'config', args: {} } });
  } finally {
    await s.close();
  }
});

test('/command: 400 with the error when the runner rejects', async () => {
  const s = await startCommandServer({ runCommand: async () => { throw new Error('Unknown op "x".'); } });
  try {
    const res = await post(s.url, JSON.stringify({ agentId: 'agent-1', op: 'x', args: {} }), cmdHeaders());
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'Unknown op "x".' });
  } finally {
    await s.close();
  }
});

test('/command: 400 for a body that is not JSON or lacks op', async () => {
  const s = await startCommandServer();
  try {
    assert.equal((await post(s.url, '{nope', cmdHeaders())).status, 400);
    assert.equal((await post(s.url, JSON.stringify({ agentId: 'agent-1' }), cmdHeaders())).status, 400);
  } finally {
    await s.close();
  }
});

test('/command: 403 for a wrong secret and 404 for an unknown agent, each with a warn line', async () => {
  let ran = 0;
  const s = await startCommandServer({ runCommand: async () => ++ran });
  try {
    const r403 = await post(s.url, JSON.stringify({ agentId: 'agent-1', op: 'config', args: {} }), { 'x-cc-secret': 'wrong' });
    assert.equal(r403.status, 403);
    const r404 = await post(s.url, JSON.stringify({ agentId: 'ghost', op: 'config', args: {} }), cmdHeaders('ghost'));
    assert.equal(r404.status, 404);
    assert.equal(ran, 0);
    const warns = s.logs.filter((l) => l[0] === 'warn').map((l) => l.join(' '));
    assert.equal(warns.length, 2);
    assert.match(warns[0], /agent-1.*403/);
    assert.match(warns[1], /ghost.*404/);
  } finally {
    await s.close();
  }
});

test('/command: a runner slower than the server socket timeout still answers 200', async () => {
  const s = await startCommandServer({
    socketTimeout: 50,
    runCommand: () => new Promise((r) => setTimeout(() => r({ slow: true }), 200)),
  });
  try {
    const res = await post(s.url, JSON.stringify({ agentId: 'agent-1', op: 'forget', args: {} }), cmdHeaders());
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body).result, { slow: true });
  } finally {
    await s.close();
  }
});

test('/command: a multi-byte character split across two writes arrives intact', async () => {
  let got;
  const s = await startCommandServer({ runCommand: async (_id, _op, args) => (got = args.prompt) });
  try {
    const body = Buffer.from(JSON.stringify({ agentId: 'agent-1', op: 'spawn', args: { prompt: 'a中b' } }), 'utf8');
    const cut = body.indexOf(Buffer.from('中', 'utf8')) + 1; // inside the 3-byte character
    const status = await new Promise((resolve, reject) => {
      const req = http.request(s.url, { method: 'POST', headers: cmdHeaders() }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.write(body.subarray(0, cut));
      setTimeout(() => req.end(body.subarray(cut)), 20);
    });
    assert.equal(status, 200);
    assert.equal(got, 'a中b');
  } finally {
    await s.close();
  }
});

test('/command: without a runner the route is 404', async () => {
  const handler = createRequestHandler({ agents: new Map(), agentSecret: () => 'x', sendToRenderer: () => {} });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await post(`http://127.0.0.1:${server.address().port}/command`, '{}');
    assert.equal(res.status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
