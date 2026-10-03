'use strict';

// ---------------------------------------------------------------------------
// Remote-access protocol v1: frame validation and the per-connection handler.
// No electron dependency — everything main-process shaped (ptys, ring buffers,
// the agents snapshot, rpc, the event hub) is injected, so it is unit tested
// (test/remoteproto.test.js) against the shared contract fixtures in
// test/fixtures/remote-proto/, which the phone app tests against too.
//
// Auth happens before a connection reaches this handler (at WebSocket upgrade,
// see remoteserver.js), so every frame here is from a paired device. Frames are
// still validated strictly: the first malformed one closes the connection.
// ---------------------------------------------------------------------------

const { isPushToken } = require('./fcm');

const MAX_INPUT_CHARS = 16384;
const MIN_DIM = 2;
const MAX_DIM = 500;
const MAX_ID = 128;
const MAX_PATH = 4096;
// Sent before a replay so stale SGR/charset state never leaks into it.
const RESET = '\x1bc';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
const isPath = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_PATH;
const isDim = (v) => Number.isInteger(v) && v >= MIN_DIM && v <= MAX_DIM;
const isBool = (v) => typeof v === 'boolean';
// A display name: 1-80 chars, no control characters.
const isName = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 80 && !/[\x00-\x1f\x7f]/.test(v);

// Per-method argument validators. A method missing here is not callable.
const RPC_ARGS = {
  'projects.list': () => true,
  'workspaces.list': () => true,
  'worktrees.list': (a) => isPath(a.dir),
  spawn: (a) => isPath(a.dir) && isPath(a.cwd) && isDim(a.cols) && isDim(a.rows),
  resume: (a) =>
    isId(a.id) && (a.cols === undefined && a.rows === undefined ? true : isDim(a.cols) && isDim(a.rows)),
  kill: (a) => isId(a.id),
  'git.diffstat': (a) => isPath(a.cwd),
  'git.diff': (a) => isPath(a.cwd) && (a.mode === 'wip' || a.mode === 'branch'),
  'git.fetch': (a) => isPath(a.cwd),
  'git.pull': (a) => isPath(a.cwd),
  transcript: (a) => isId(a.id),
  'agent.rename': (a) => isId(a.id) && isName(a.name),
  // Forget = stop + stop tracking; a worktree's folder (and branch) can go too.
  'agent.forget': (a) =>
    isId(a.id) && [a.deleteWorktree, a.deleteBranch, a.force].every((v) => v === undefined || isBool(v)),
  'fs.list': (a) => a.path === undefined || isPath(a.path),
  'project.add': (a) => isPath(a.dir),
  'workspace.create': (a) => isPath(a.parent) && isBool(a.useParent) && (a.name === undefined || isName(a.name)),
};

const FRAME_RULES = {
  attach: (f) => isId(f.id) && isDim(f.cols) && isDim(f.rows),
  detach: (f) => isId(f.id),
  'push-register': (f) => isPushToken(f.token),
  input: (f) => isId(f.id) && typeof f.data === 'string' && f.data.length <= MAX_INPUT_CHARS,
  resize: (f) => isId(f.id) && isDim(f.cols) && isDim(f.rows),
  rpc: (f) =>
    Number.isInteger(f.reqId) &&
    f.reqId >= 0 &&
    Object.prototype.hasOwnProperty.call(RPC_ARGS, f.method) &&
    isObj(f.args) &&
    RPC_ARGS[f.method](f.args),
};

// raw text frame -> { ok: true, frame } | { ok: false, why }
function parseClientFrame(raw) {
  let f;
  try {
    f = JSON.parse(String(raw));
  } catch {
    return { ok: false, why: 'not JSON' };
  }
  if (!isObj(f)) return { ok: false, why: 'not an object' };
  const rule = Object.prototype.hasOwnProperty.call(FRAME_RULES, f.t) ? FRAME_RULES[f.t] : null;
  if (!rule) return { ok: false, why: `unknown type ${JSON.stringify(f.t)}` };
  if (!rule(f)) return { ok: false, why: `invalid ${f.t}${f.method ? ' ' + f.method : ''}` };
  return { ok: true, frame: f };
}

// Who last sized each pty, and at what size. One pty has one size, so the
// last-active client (desktop or remote) owns it. request() says whether the
// pty actually needs resizing, so an unchanged size never triggers a redraw.
// DEC private modes a phone must know to show and drive the app correctly.
// Apps switch them on once at startup, long before what the ring buffer still
// holds, so replay re-sends the ones that are on: alternate screen, mouse
// tracking + encoding, bracketed paste, focus reports.
const REPLAY_MODES = [1049, 1047, 47, 1000, 1002, 1003, 1005, 1006, 1015, 2004, 1004];
const MODE_SEQ = /\x1b\[\?([\d;]+)([hl])/g;

function createModeTracker() {
  const on = new Set();
  let carry = '';
  return {
    feed(data) {
      const text = carry + data;
      MODE_SEQ.lastIndex = 0;
      let m;
      let end = 0;
      while ((m = MODE_SEQ.exec(text))) {
        for (const p of m[1].split(';')) {
          const mode = Number(p);
          if (!REPLAY_MODES.includes(mode)) continue;
          if (m[2] === 'h') on.add(mode);
          else on.delete(mode);
        }
        end = MODE_SEQ.lastIndex;
      }
      // Keep a possibly incomplete sequence at the end for the next chunk.
      const esc = text.lastIndexOf('\x1b');
      carry = esc >= end && text.length - esc < 32 ? text.slice(esc) : '';
    },
    prefix() {
      return REPLAY_MODES.filter((mode) => on.has(mode))
        .map((mode) => `\x1b[?${mode}h`)
        .join('');
    },
  };
}

function createSizeTracker() {
  const sizes = new Map(); // id -> { owner, cols, rows }
  return {
    request(id, owner, cols, rows) {
      const cur = sizes.get(id);
      sizes.set(id, { owner, cols, rows });
      return !cur || cur.cols !== cols || cur.rows !== rows;
    },
    owner(id) {
      return sizes.get(id)?.owner ?? null;
    },
    forget(id) {
      sizes.delete(id);
    },
  };
}

// deps:
//   send(obj)                - send one frame to this client
//   close(code, reason)      - close this client
//   hub                      - EventEmitter: 'data'(id, seq, data), 'exit'(id, {exitCode, error}),
//                              'agents'(frame) for every pty chunk / exit / snapshot change
//   hasPty(id)               - is there a live pty for this agent
//   getBuffer(id)            - the agent's ring buffer (or null)
//   writeInput(id, data)     - write to the pty
//   resize(id, cols, rows, owner, {repaint}) - resize via the size tracker;
//                              repaint forces a redraw even at an unchanged size
//   sizeOwner(id)            - current size owner ('desktop' | 'remote' | null)
//   takeover(id, cols, rows) - the desktop has control: restart the session at the
//                              phone's size so it redraws there. true (or a Promise
//                              of true) when restarted; false = no resumable session
//   modePrefix(id)           - escape sequences re-enabling the app's terminal modes
//   registerPush(token)      - remember this phone's FCM token (background alerts)
//   getAgents()              - current { seq, desktopUi, list }
//   rpc(method, args)        - Promise of the result; rejects with an Error to report
//   log                      - { warn, info }
function createConnectionHandler(deps) {
  const { send, close, hub, log } = deps;
  // id -> { lastSeq, cols, rows } for agents this client is attached to
  const attached = new Map();
  let closed = false;

  const safeSend = (obj) => {
    if (!closed) send(obj);
  };

  const onData = (id, seq, data) => {
    const a = attached.get(id);
    if (a && seq > a.lastSeq) {
      a.lastSeq = seq;
      safeSend({ t: 'data', id, seq, data });
    }
  };
  const onExit = (id, info = {}) => {
    if (!attached.delete(id)) return;
    const frame = { t: 'exit', id, exitCode: info.exitCode ?? null };
    if (info.error) frame.error = info.error;
    safeSend(frame);
  };
  const onAgents = (frame) => safeSend({ t: 'agents', ...frame });

  hub.on('data', onData);
  hub.on('exit', onExit);
  hub.on('agents', onAgents);

  // Open a terminal on the phone. While the desktop has control, the session is
  // restarted (resumed) at the phone's size: the app reprints the conversation
  // at this width, so the phone gets a clean scrollback. When the phone already
  // has control, its buffer was drawn at phone width and is replayed as-is.
  function attach({ id, cols, rows }) {
    if (!deps.hasPty(id)) {
      safeSend({ t: 'exit', id, exitCode: null, error: 'Agent is not running.' });
      return;
    }
    if (deps.sizeOwner(id) === 'remote') {
      deps.resize(id, cols, rows, 'remote');
      return subscribe(id, cols, rows, true);
    }
    const restarted = deps.takeover(id, cols, rows);
    if (restarted && typeof restarted.then === 'function') {
      restarted.then(
        (ok) => !closed && finishTakeover(id, cols, rows, ok),
        (err) => {
          log.warn('remote', `takeover failed: ${(err && err.message) || err}`);
          if (!closed) finishTakeover(id, cols, rows, false);
        },
      );
    } else {
      finishTakeover(id, cols, rows, restarted);
    }
  }

  function finishTakeover(id, cols, rows, restarted) {
    if (restarted) {
      if (!deps.hasPty(id)) {
        safeSend({ t: 'exit', id, exitCode: null, error: 'Agent did not restart.' });
        return;
      }
      return subscribe(id, cols, rows, true);
    }
    // No session to resume (nothing sent yet): old output was drawn at the
    // desktop's width and would fill the phone's scrollback with garbage, so
    // force a repaint at the phone's size and replay only a reset.
    deps.resize(id, cols, rows, 'remote', { repaint: true });
    subscribe(id, cols, rows, false);
  }

  // Snapshot + subscribe in one synchronous tick: nothing can be appended in
  // between, so live data continues exactly after lastSeq.
  function subscribe(id, cols, rows, withBuffer) {
    const buf = deps.getBuffer(id);
    const { data, lastSeq } = buf ? buf.snapshot() : { data: '', lastSeq: 0 };
    attached.set(id, { lastSeq, cols, rows });
    safeSend({ t: 'replay', id, lastSeq, data: RESET + deps.modePrefix(id) + (withBuffer ? data : '') });
  }

  async function rpc({ reqId, method, args }) {
    try {
      const result = await deps.rpc(method, args);
      safeSend({ t: 'rpc-result', reqId, ok: true, result: result ?? null });
    } catch (err) {
      safeSend({ t: 'rpc-result', reqId, ok: false, error: (err && err.message) || String(err) });
    }
  }

  const handlers = {
    attach,
    detach: ({ id }) => attached.delete(id),
    'push-register': ({ token }) => deps.registerPush(token),
    input: ({ id, data }) => {
      const a = attached.get(id);
      if (!a) return;
      // The desktop took over: the phone shows "Take over" instead of the
      // terminal, so anything still typed is dropped.
      if (deps.sizeOwner(id) !== 'remote') return;
      deps.writeInput(id, data);
    },
    resize: ({ id, cols, rows }) => {
      const a = attached.get(id);
      if (!a) return;
      a.cols = cols;
      a.rows = rows;
      deps.resize(id, cols, rows, 'remote');
    },
    rpc,
  };

  safeSend({ t: 'agents', ...deps.getAgents() });

  return {
    onMessage(raw) {
      if (closed) return;
      const r = parseClientFrame(raw);
      if (!r.ok) {
        log.warn('remote', `closing connection: ${r.why}`);
        close(1008, 'invalid frame');
        this.onClose();
        return;
      }
      handlers[r.frame.t](r.frame);
    },
    onClose() {
      if (closed) return;
      closed = true;
      attached.clear();
      hub.off('data', onData);
      hub.off('exit', onExit);
      hub.off('agents', onAgents);
    },
  };
}

module.exports = {
  parseClientFrame,
  createConnectionHandler,
  createSizeTracker,
  createModeTracker,
  RPC_METHODS: Object.keys(RPC_ARGS),
  MAX_INPUT_CHARS,
};
