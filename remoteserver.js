'use strict';

// ---------------------------------------------------------------------------
// Remote-access WSS server. No electron dependency (see
// test/remoteserver.test.js); main.js injects the cert, token, lockout and the
// per-connection protocol handler (remoteproto.js).
//
// Auth happens at the HTTP upgrade, before any WebSocket exists:
//   locked-out IP -> 401, bad/missing `Authorization: Bearer` -> 401 (counts as
//   a failure), wrong `x-cc-proto` -> 426. So an unauthenticated peer never
//   holds a socket open, and never sees a single protocol frame.
// ---------------------------------------------------------------------------

const https = require('https');
const { WebSocketServer, WebSocket } = require('ws');
const { checkBearer } = require('./remoteauth');

const PROTO_VERSION = '1';

function reject(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

// opts:
//   cert, key       - PEM strings
//   getToken()      - current pairing token (read per attempt so Regenerate applies at once)
//   lockout         - remoteauth.createLockout()
//   createHandler({ send, close, ip }) -> { onMessage(text), onClose() }
//   log             - { info, warn, error }
//   heartbeatMs     - ping interval; a client that misses one pong is terminated
//   maxBuffered     - bufferedAmount above which a slow client is terminated
//   maxPayload      - max inbound frame size
function createRemoteServer({
  cert,
  key,
  getToken,
  lockout,
  createHandler,
  log,
  heartbeatMs = 25000,
  maxBuffered = 1024 * 1024,
  maxPayload = 256 * 1024,
}) {
  const clients = new Map(); // ws -> { ip, since, alive }
  const wss = new WebSocketServer({ noServer: true, maxPayload });
  const server = https.createServer({ cert, key, minVersion: 'TLSv1.2' }, (_req, res) => {
    res.writeHead(426, { Connection: 'close' }).end();
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.on('tlsClientError', (err) => log.info('remote', `TLS handshake failed: ${err.message}`));

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    const ip = req.socket.remoteAddress || '?';
    if (lockout.isLocked(ip)) {
      reject(socket, 401, 'Unauthorized');
      return;
    }
    if (!checkBearer(req.headers.authorization, getToken())) {
      lockout.recordFailure(ip);
      log.warn('remote', `auth failure from ${ip}`);
      reject(socket, 401, 'Unauthorized');
      return;
    }
    if (req.headers['x-cc-proto'] !== PROTO_VERSION) {
      reject(socket, 426, 'Upgrade Required');
      return;
    }
    lockout.recordSuccess(ip);
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip));
  });

  function onConnection(ws, ip) {
    const info = { ip, since: Date.now(), alive: true };
    clients.set(ws, info);
    log.info('remote', `client connected from ${ip}`);

    const send = (obj) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > maxBuffered) {
        log.warn('remote', `terminating slow client ${ip} (${ws.bufferedAmount} bytes buffered)`);
        ws.terminate();
        return;
      }
      ws.send(JSON.stringify(obj));
    };
    const handler = createHandler({ send, close: (code, reason) => ws.close(code, reason), ip });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        ws.close(1003, 'text frames only');
        return;
      }
      handler.onMessage(data.toString());
    });
    ws.on('pong', () => {
      info.alive = true;
    });
    ws.on('error', (err) => log.warn('remote', `client ${ip} error: ${err.message}`));
    ws.on('close', () => {
      handler.onClose();
      clients.delete(ws);
      log.info('remote', `client ${ip} disconnected`);
    });
  }

  // One ping pass: terminate clients that missed the previous ping's pong.
  function heartbeat() {
    for (const [ws, info] of clients) {
      if (!info.alive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      info.alive = false;
      try {
        ws.ping();
      } catch {
        /* socket already gone */
      }
    }
  }
  const timer = setInterval(heartbeat, heartbeatMs);
  timer.unref();

  return {
    listen(port, host) {
      return new Promise((resolve, rejectListen) => {
        const onError = (err) => rejectListen(err);
        server.once('error', onError);
        server.listen(port, host, () => {
          server.off('error', onError);
          server.on('error', (err) => log.error('remote', 'server error', err));
          resolve({ port: server.address().port });
        });
      });
    },
    close() {
      clearInterval(timer);
      for (const ws of clients.keys()) ws.terminate();
      clients.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    },
    closeAll(code = 1001, reason = '') {
      for (const ws of clients.keys()) ws.close(code, reason);
    },
    clients() {
      return [...clients.values()].map(({ ip, since }) => ({ ip, since }));
    },
    setSecureContext({ cert: c, key: k }) {
      server.setSecureContext({ cert: c, key: k, minVersion: 'TLSv1.2' });
    },
    heartbeat,
  };
}

module.exports = { createRemoteServer, PROTO_VERSION };
