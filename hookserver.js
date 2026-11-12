'use strict';

// ---------------------------------------------------------------------------
// Local hook-event HTTP request handler. No electron dependency (everything
// electron-shaped — the live agents map, the per-agent secret, the renderer
// sink, the command runner, the logger — is injected) so it can be
// integration tested with a real http server bound to 127.0.0.1:0 (see
// test/hookserver.test.js). main.js wraps the handler this module builds in
// http.createServer/.listen.
//
// Routes (both POST, both authenticated the same way: a live agentId plus
// that agent's own x-cc-secret):
//   /event    status hook events from hooks/report.js → the renderer
//   /command  config/spawn/forget from hooks/cc.js → runCommand (ccommand.js)
// ---------------------------------------------------------------------------

const hookAuth = require('./hookauth');

const MAX_BODY_BYTES = 64 * 1024;
// A forget can stop several sessions and wait for a locked folder: far over
// main.js's 5s server.setTimeout. Set per request, because Node resets the
// socket timeout to keepAliveTimeout after each response.
const COMMAND_SOCKET_TIMEOUT_MS = 130000;

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

const sendJson = (res, status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));

// Build the (req, res) handler. deps:
//   agents        - Map-like with .has(id): which agentIds are currently live
//   agentSecret   - (id) => string, the expected per-agent token for that id
//   sendToRenderer- (channel, payload) => void, called with ('agent:event', event)
//                   once auth passes
//   runCommand    - optional (agentId, op, args) => Promise<result>; rejects
//                   with an Error to refuse. Without it /command is a 404.
//   log           - optional {info,warn,error}; defaults to a no-op logger
function createRequestHandler({ agents, agentSecret, sendToRenderer, runCommand, log = noopLog }) {
  // Reads the body as UTF-8 text (setEncoding keeps a multi-byte character
  // split across chunks intact), capped at MAX_BODY_BYTES. Calls done(body),
  // or answers 413 itself.
  function readBody(req, res, done) {
    // A client reset mid-stream emits 'error' on req; with no listener Node
    // throws it as an uncaught exception that would kill the whole main process
    // (and every live pty with it).
    req.on('error', (err) => {
      log.warn('hook-server', 'request stream error', err);
      res.destroy();
    });
    req.setEncoding('utf8');
    let body = '';
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      body += c;
      if (body.length > MAX_BODY_BYTES) {
        // A hook payload is tiny; anything this large is malformed/hostile.
        tooBig = true;
        res.writeHead(413).end();
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!tooBig) done(body);
    });
  }

  // The agentId must be live AND the request must carry that agent's own
  // token. Returns the HTTP status to refuse with, or 0 when it passes.
  function authStatus(req, id) {
    if (!id || typeof id !== 'string' || !agents.has(id)) return 404;
    if (!hookAuth.secretMatches(req.headers['x-cc-secret'], agentSecret(id))) return 403;
    return 0;
  }

  function handleEvent(req, res) {
    readBody(req, res, (body) => {
      let event;
      try {
        event = JSON.parse(body);
      } catch (err) {
        log.warn('hook-server', 'malformed event body', err);
        res.writeHead(400).end();
        return;
      }
      // A stale/forged agentId — or a live one without its token — must never
      // reach the renderer, where it could overwrite a persisted sessionId
      // later used by `claude --resume`.
      const status = authStatus(req, event && event.agentId);
      if (status) {
        res.writeHead(status).end();
        return;
      }
      sendToRenderer('agent:event', event);
      res.writeHead(200).end();
    });
  }

  function handleCommand(req, res) {
    req.socket.setTimeout(COMMAND_SOCKET_TIMEOUT_MS);
    readBody(req, res, async (body) => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch (err) {
        log.warn('command', 'malformed command body', err);
        sendJson(res, 400, { ok: false, error: 'The request body is not JSON.' });
        return;
      }
      const id = msg && msg.agentId;
      const status = authStatus(req, id);
      if (status) {
        log.warn('command', `rejected caller=${typeof id === 'string' ? id : '?'} status=${status}`);
        res.writeHead(status).end();
        return;
      }
      if (typeof msg.op !== 'string') {
        sendJson(res, 400, { ok: false, error: 'Missing op.' });
        return;
      }
      try {
        const result = await runCommand(id, msg.op, msg.args === undefined ? {} : msg.args);
        sendJson(res, 200, { ok: true, result: result === undefined ? null : result });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: (err && err.message) || 'Command failed.' });
      }
    });
  }

  return function handleHookRequest(req, res) {
    if (req.method === 'POST' && req.url === '/event') return handleEvent(req, res);
    if (req.method === 'POST' && req.url === '/command' && runCommand) return handleCommand(req, res);
    res.writeHead(404).end();
  };
}

module.exports = { createRequestHandler, MAX_BODY_BYTES };
