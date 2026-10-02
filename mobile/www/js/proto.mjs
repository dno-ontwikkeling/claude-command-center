// Remote-access protocol v1, WebView side. Pure (no DOM, no Capacitor) so it is
// unit tested against the same fixtures as the desktop
// (test/fixtures/remote-proto/). The native service owns the socket and the
// auth handshake; it forwards every server frame here as text and sends the
// frames built here.

const MIN_DIM = 2;
const MAX_DIM = 500;
const dim = (n) => Math.min(MAX_DIM, Math.max(MIN_DIM, Math.floor(n)));

// ---- client -> server frames ------------------------------------------------

export const attachFrame = (id, cols, rows) => ({ t: 'attach', id, cols: dim(cols), rows: dim(rows) });
export const detachFrame = (id) => ({ t: 'detach', id });
export const inputFrame = (id, data) => ({ t: 'input', id, data });
export const resizeFrame = (id, cols, rows) => ({ t: 'resize', id, cols: dim(cols), rows: dim(rows) });
export const rpcFrame = (reqId, method, args) => ({ t: 'rpc', reqId, method, args });

// ---- server -> client frames ------------------------------------------------

const SERVER_TYPES = new Set(['agents', 'replay', 'data', 'exit', 'rpc-result']);

// text -> frame object, or null for anything that isn't a known frame.
export function parseServerFrame(text) {
  let f;
  try {
    f = JSON.parse(text);
  } catch {
    return null;
  }
  if (!f || typeof f !== 'object' || Array.isArray(f) || !SERVER_TYPES.has(f.t)) return null;
  return f;
}

// ---- agents list ------------------------------------------------------------

// Mirrors the desktop's agent list. `seq` only grows within one desktop run;
// call reset() on every (re)connect, since a restarted desktop starts over at 1.
export function createAgentsState() {
  let seq = 0;
  return {
    list: [],
    desktopUi: false,
    apply(frame) {
      if (frame.seq <= seq) return false;
      seq = frame.seq;
      this.list = Array.isArray(frame.list) ? frame.list : [];
      this.desktopUi = !!frame.desktopUi;
      return true;
    },
    reset() {
      seq = 0;
    },
    get(id) {
      return this.list.find((a) => a.id === id) || null;
    },
    live() {
      return this.list.filter((a) => !a.dormant);
    },
    dormant() {
      return this.list.filter((a) => a.dormant);
    },
  };
}

// ---- rpc --------------------------------------------------------------------

export function createRpcClient({ send, timeoutMs = 10000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pending = new Map(); // reqId -> { resolve, reject, timer }
  let nextId = 1;
  return {
    call(method, args = {}) {
      const reqId = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimer(() => {
          pending.delete(reqId);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        pending.set(reqId, { resolve, reject, timer });
        send(rpcFrame(reqId, method, args));
      });
    },
    onResult(frame) {
      const p = pending.get(frame.reqId);
      if (!p) return;
      pending.delete(frame.reqId);
      clearTimer(p.timer);
      if (frame.ok) p.resolve(frame.result ?? null);
      else p.reject(new Error(frame.error || 'Request failed'));
    },
    failAll(err) {
      for (const [reqId, p] of pending) {
        clearTimer(p.timer);
        p.reject(err);
        pending.delete(reqId);
      }
    },
  };
}

// ---- one attached terminal --------------------------------------------------

// replay -> reset the terminal and write the snapshot; then write only live
// data newer than the snapshot (the server may re-deliver around the boundary).
export function createStream() {
  let lastSeq = null; // null until the first replay
  return {
    onReplay(frame) {
      lastSeq = frame.lastSeq;
      return { reset: true, data: frame.data };
    },
    onData(frame) {
      if (lastSeq === null || frame.seq <= lastSeq) return null;
      lastSeq = frame.seq;
      return frame.data;
    },
  };
}
