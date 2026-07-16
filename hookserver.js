'use strict';

// ---------------------------------------------------------------------------
// Local hook-event HTTP request handler. No electron dependency (everything
// electron-shaped — the live agents map, the per-agent secret, the renderer
// sink, the logger — is injected) so it can be integration tested with a real
// http server bound to 127.0.0.1:0 (see test/hookserver.test.js). main.js wraps
// the handler this module builds in http.createServer/.listen.
// ---------------------------------------------------------------------------

const hookAuth = require('./hookauth');

const MAX_BODY_BYTES = 64 * 1024;

const noopLog = { warn: () => {}, error: () => {} };

// Build the (req, res) handler for POST /event. deps:
//   agents        - Map-like with .has(id): which agentIds are currently live
//   agentSecret   - (id) => string, the expected per-agent token for that id
//   sendToRenderer- (channel, payload) => void, called with ('agent:event', event)
//                   once auth passes
//   log           - optional {warn,error}; defaults to a no-op logger
function createRequestHandler({ agents, agentSecret, sendToRenderer, log = noopLog }) {
  return function handleHookRequest(req, res) {
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404).end();
      return;
    }
    // A client reset mid-stream emits 'error' on req; with no listener Node
    // throws it as an uncaught exception that would kill the whole main process
    // (and every live pty with it).
    req.on('error', (err) => {
      log.warn('hook-server', 'request stream error', err);
      res.destroy();
    });
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
      if (tooBig) return;
      let event;
      try {
        event = JSON.parse(body);
      } catch (err) {
        log.warn('hook-server', 'malformed event body', err);
        res.writeHead(400).end();
        return;
      }
      // The agentId must be live AND the request must carry that agent's own
      // token. A stale/forged agentId — or a live one without its token — must
      // never reach the renderer, where it could overwrite a persisted
      // sessionId later used by `claude --resume`.
      const id = event && event.agentId;
      if (!id || !agents.has(id)) {
        res.writeHead(404).end();
        return;
      }
      if (!hookAuth.secretMatches(req.headers['x-cc-secret'], agentSecret(id))) {
        res.writeHead(403).end();
        return;
      }
      sendToRenderer('agent:event', event);
      res.writeHead(200).end();
    });
  };
}

module.exports = { createRequestHandler, MAX_BODY_BYTES };
