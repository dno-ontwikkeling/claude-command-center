'use strict';

// ---------------------------------------------------------------------------
// Capped per-agent scrollback buffer for remote attach/replay. No electron
// dependency (see test/ringbuffer.test.js). Each append gets a monotonic seq so
// a remote client can take a snapshot and then drop live chunks it already has
// (seq <= lastSeq). When over cap, the oldest output is dropped and the new head
// is moved to a safe boundary: never mid surrogate pair or mid escape sequence,
// preferably at a line start, so a replay doesn't open with garbage.
// ---------------------------------------------------------------------------

const DEFAULT_CAP = 512 * 1024;
// How far past the cut we look for a newline to start on.
const LINE_WINDOW = 2048;
// How far before the cut we look for an escape sequence that might contain it.
const ESC_LOOKBACK = 1024;

const ESC = '\x1b';

// Index just past the escape sequence starting at s[p] (an ESC), or -1 if the
// sequence is not terminated within s.
function escEnd(s, p) {
  const kind = s[p + 1];
  if (kind === undefined) return -1;
  if (kind === '[') {
    // CSI: params/intermediates, then a final byte 0x40-0x7E.
    for (let k = p + 2; k < s.length; k++) {
      const c = s.charCodeAt(k);
      if (c >= 0x40 && c <= 0x7e) return k + 1;
      if (c < 0x20 || c > 0x3f) return k; // malformed; treat as ended
    }
    return -1;
  }
  if (kind === ']' || kind === 'P' || kind === '_' || kind === '^' || kind === 'X') {
    // OSC/DCS/APC/PM/SOS: string terminated by BEL (OSC) or ST (ESC \).
    for (let k = p + 2; k < s.length; k++) {
      if (s[k] === '\x07') return k + 1;
      if (s[k] === ESC && s[k + 1] === '\\') return k + 2;
    }
    return -1;
  }
  // Two-char escape, optionally with intermediates (e.g. ESC ( B).
  let k = p + 1;
  while (k < s.length && s.charCodeAt(k) >= 0x20 && s.charCodeAt(k) <= 0x2f) k++;
  return k < s.length ? k + 1 : -1;
}

// Move cut index i forward to a safe place to start a replay.
function safeStart(s, i) {
  const nl = s.indexOf('\n', i);
  if (nl !== -1 && nl - i <= LINE_WINDOW) i = nl + 1;
  for (;;) {
    let moved = false;
    const p = s.lastIndexOf(ESC, i - 1);
    if (p !== -1 && i - p <= ESC_LOOKBACK) {
      const end = escEnd(s, p);
      if (end === -1) return s.length; // cut inside an unterminated sequence
      if (end > i) {
        i = end;
        moved = true;
      }
    }
    if (i < s.length && (s.charCodeAt(i) & 0xfc00) === 0xdc00) {
      i++;
      moved = true;
    }
    if (!moved) return i;
  }
}

function createRingBuffer({ cap = DEFAULT_CAP } = {}) {
  let chunks = [];
  let total = 0;
  let seq = 0;

  function trim() {
    while (total > cap && chunks.length > 1 && total - chunks[0].length >= cap) {
      total -= chunks.shift().length;
    }
    if (total > cap) {
      const head = chunks[0];
      const cut = safeStart(head, total - cap);
      chunks[0] = head.slice(cut);
      total -= cut;
      if (!chunks[0]) chunks.shift();
    }
  }

  return {
    append(data) {
      const s = String(data);
      seq++;
      if (s) {
        chunks.push(s);
        total += s.length;
        trim();
      }
      return seq;
    },
    snapshot() {
      return { data: chunks.join(''), lastSeq: seq };
    },
    clear() {
      chunks = [];
      total = 0;
    },
  };
}

module.exports = { createRingBuffer, safeStart, DEFAULT_CAP };
