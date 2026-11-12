'use strict';

// Command Center CLI for the /cc-manage and /cc-clean-worktrees skills.
//
//   node "$CC_CLI" <op> <<'CC_ARGS_EOF'
//   { ...JSON args... }
//   CC_ARGS_EOF
//
//   node "$CC_CLI" config < /dev/null
//
// Posts { agentId, op, args } to Command Center's local /command endpoint
// (127.0.0.1:$CC_PORT) with this session's own secret, prints the result as
// JSON on stdout and exits 0. On a refusal or error it prints the message on
// stderr and exits 1. Outside a Command Center session (no CC_PORT /
// CC_AGENT_ID / CC_SECRET) it exits 2.
//
// Node built-ins only: this file is unpacked from the asar and run by plain
// `node`, not Electron.

const http = require('http');

const port = process.env.CC_PORT;
const agentId = process.env.CC_AGENT_ID;
const secret = process.env.CC_SECRET;
const op = process.argv[2];

// A forget can take a while (several sessions, a locked folder); the server
// allows 130s per /command request.
const REQUEST_TIMEOUT_MS = 130000;
// Inside Claude Code on Windows, stdin can be a pipe that never closes. With
// no data this soon, there are no arguments.
const STDIN_IDLE_MS = 500;

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

if (!port || !agentId || !secret) {
  fail('Run this from a Command Center session (CC_PORT, CC_AGENT_ID and CC_SECRET are not set).', 2);
}
if (!op) fail('Usage: node cc.js <config|spawn|forget>, with JSON arguments on stdin.');

function readArgs() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (stdin.isTTY) {
      resolve('');
      return;
    }
    let text = '';
    let gotData = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(idle);
      resolve(text);
    };
    const idle = setTimeout(() => {
      if (gotData) return;
      // Nothing arrived: stop waiting on a pipe that may never close.
      stdin.pause();
      stdin.destroy();
      finish();
    }, STDIN_IDLE_MS);
    stdin.setEncoding('utf8');
    stdin.on('data', (c) => {
      gotData = true;
      text += c;
    });
    stdin.on('end', finish);
    stdin.on('error', finish);
  });
}

function post(body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: Number(port),
        path: '/command',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-cc-secret': secret,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        res.setEncoding('utf8');
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, data }));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Command Center did not answer in time.')));
    req.on('error', reject);
    req.end(body);
  });
}

(async () => {
  const raw = (await readArgs()).trim();
  let args = {};
  if (raw) {
    try {
      args = JSON.parse(raw);
    } catch (err) {
      fail(`The arguments on stdin are not valid JSON: ${err.message}`);
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) fail('The arguments on stdin must be a JSON object.');
  }

  let res;
  try {
    res = await post(JSON.stringify({ agentId, op, args }));
  } catch (err) {
    fail(
      err && err.code === 'ECONNREFUSED'
        ? `Command Center is not reachable on port ${port}. Is the app still running?`
        : `Could not reach Command Center: ${(err && err.message) || err}`
    );
  }

  let payload = null;
  try {
    payload = JSON.parse(res.data);
  } catch {
    /* 403/404/413 have no body */
  }
  if (res.status === 200 && payload && payload.ok) {
    process.stdout.write(`${JSON.stringify(payload.result, null, 2)}\n`);
    process.exit(0);
  }
  if (payload && payload.error) fail(payload.error);
  if (res.status === 403 || res.status === 404) {
    fail(`Command Center rejected this session (HTTP ${res.status}). Restart the session from Command Center.`);
  }
  fail(`Command Center answered HTTP ${res.status}.`);
})();
