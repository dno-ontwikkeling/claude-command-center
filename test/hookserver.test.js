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
