'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequestHandler } = require('../hookserver');
const { agentSecret } = require('../hookauth');

const CLI = path.join(__dirname, '..', 'hooks', 'cc.js');
const MASTER = 'feedface'.repeat(8);

function startServer(runCommand) {
  const calls = [];
  const handler = createRequestHandler({
    agents: new Map([['agent-1', {}]]),
    agentSecret: (id) => agentSecret(MASTER, id),
    sendToRenderer: () => {},
    runCommand: async (id, op, args) => {
      calls.push({ id, op, args });
      return runCommand ? runCommand(id, op, args) : { echo: args };
    },
  });
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, calls, close: () => new Promise((r) => server.close(r)) })
    );
  });
}

// stdin: 'ignore' (no stdin), a string (written then closed), or 'open' (a
// pipe that is never written to or closed).
function runCli(op, { port, env, stdin = 'ignore', secret } = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...process.env };
    delete childEnv.CC_PORT;
    delete childEnv.CC_AGENT_ID;
    delete childEnv.CC_SECRET;
    if (port) {
      childEnv.CC_PORT = String(port);
      childEnv.CC_AGENT_ID = 'agent-1';
      childEnv.CC_SECRET = secret || agentSecret(MASTER, 'agent-1');
    }
    Object.assign(childEnv, env || {});
    const started = Date.now();
    const child = spawn(process.execPath, [CLI, ...(op ? [op] : [])], {
      env: childEnv,
      stdio: [stdin === 'ignore' ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c) => (stderr += c));
    if (typeof stdin === 'string' && stdin !== 'ignore' && stdin !== 'open') child.stdin.end(stdin);
    const killer = setTimeout(() => child.kill(), 10000);
    child.on('close', (code) => {
      clearTimeout(killer);
      if (stdin === 'open') child.stdin.destroy();
      resolve({ code, stdout, stderr, ms: Date.now() - started });
    });
  });
}

test('without the CC environment it says to run from a Command Center session and exits 2', async () => {
  const r = await runCli('config');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Run this from a Command Center session/);
});

test('config with no stdin posts {} and prints the result JSON', async () => {
  const s = await startServer(() => ({ worktreeRoot: 'C:\\wt' }));
  try {
    const r = await runCli('config', { port: s.port });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { worktreeRoot: 'C:\\wt' });
    assert.deepEqual(s.calls, [{ id: 'agent-1', op: 'config', args: {} }]);
  } finally {
    await s.close();
  }
});

test('config with an empty, closed stdin (< /dev/null) posts {}', async () => {
  const s = await startServer();
  try {
    const r = await runCli('config', { port: s.port, stdin: '' });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(s.calls[0].args, {});
  } finally {
    await s.close();
  }
});

test('config returns when stdin is a pipe that never closes', async () => {
  const s = await startServer();
  try {
    const r = await runCli('config', { port: s.port, stdin: 'open' });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.ms < 5000, `took ${r.ms}ms`);
    assert.deepEqual(s.calls[0].args, {});
  } finally {
    await s.close();
  }
});

test('JSON args on stdin arrive intact, non-ASCII and newlines included', async () => {
  const s = await startServer();
  try {
    const args = { dir: 'C:\\Github\\Repo', cwd: 'C:\\wt\\Repo\\feat', prompt: '/skill brief\nwith "quotes" é 中文 🚀' };
    const r = await runCli('spawn', { port: s.port, stdin: JSON.stringify(args, null, 2) + '\n' });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(s.calls[0].args, args);
    assert.deepEqual(JSON.parse(r.stdout), { echo: args });
  } finally {
    await s.close();
  }
});

test('invalid JSON on stdin exits 1 without calling the server', async () => {
  const s = await startServer();
  try {
    const r = await runCli('spawn', { port: s.port, stdin: '{ nope' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /JSON/);
    assert.equal(s.calls.length, 0);
  } finally {
    await s.close();
  }
});

test('a refused command prints its error to stderr and exits 1', async () => {
  const s = await startServer(() => {
    throw new Error('C:\\x is the main folder of the project "x".');
  });
  try {
    const r = await runCli('forget', { port: s.port, stdin: '{"cwd":"C:\\\\x"}' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /main folder/);
    assert.equal(r.stdout, '');
  } finally {
    await s.close();
  }
});

test('a wrong secret exits 1 with the status', async () => {
  const s = await startServer();
  try {
    const r = await runCli('config', { port: s.port, secret: 'wrong' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /403/);
  } finally {
    await s.close();
  }
});

test('an unreachable Command Center exits 1 with a clear message', async () => {
  const s = await startServer();
  const port = s.port;
  await s.close();
  const r = await runCli('config', { port });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not reachable|Could not reach/i);
});

test('a missing op prints usage and exits 1', async () => {
  const s = await startServer();
  try {
    const r = await runCli('', { port: s.port });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Usage/);
  } finally {
    await s.close();
  }
});
