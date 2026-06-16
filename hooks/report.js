'use strict';

// Lifecycle hook for Claude Code. Reports agent status to the Command Center
// HTTP server. Env-gated: if CC_PORT / CC_AGENT_ID are absent (i.e. the session
// was not launched by Command Center), this exits immediately and does nothing.

const http = require('http');

const port = process.env.CC_PORT;
const agentId = process.env.CC_AGENT_ID;
const status = process.argv[2] || 'busy';

if (!port || !agentId) process.exit(0);

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let parsed = {};
  try {
    parsed = JSON.parse(input);
  } catch {
    /* hook payload may be empty for some events */
  }

  const body = JSON.stringify({
    agentId,
    status,
    event: parsed.hook_event_name || null,
    cwd: parsed.cwd || null,
    sessionId: parsed.session_id || null,
  });

  const req = http.request(
    {
      host: '127.0.0.1',
      port: Number(port),
      path: '/event',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 500,
    },
    (res) => {
      res.on('data', () => {});
      res.on('end', () => process.exit(0));
    }
  );

  req.on('error', () => process.exit(0));
  req.on('timeout', () => req.destroy());
  req.write(body);
  req.end();
});

// Safety net: never block Claude for long.
setTimeout(() => process.exit(0), 800);
