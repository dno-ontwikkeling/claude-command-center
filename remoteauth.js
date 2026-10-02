'use strict';

// ---------------------------------------------------------------------------
// Remote-access auth helpers. No electron dependency (see
// test/remoteauth.test.js). The phone authenticates at WebSocket upgrade with
// `Authorization: Bearer <token>`; repeated failures lock the source IP out.
// The pairing payload is what the desktop QR carries: where to connect, the
// token, and the cert fingerprint the phone pins.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const { secretMatches } = require('./hookauth');

const PAIRING_PREFIX = 'ccr1:';
const HEX64 = /^[0-9a-f]{64}$/;
// wss:// + host (name, IPv4 or [IPv6]) + explicit port, optional trailing slash.
const WSS_URL = /^wss:\/\/(\[[0-9a-fA-F:]+\]|[^/:\s]+):(\d{1,5})\/?$/;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Exact `Bearer <token>` match, constant time. An unset token never matches.
function checkBearer(header, token) {
  if (!token) return false;
  const m = /^Bearer ([^\s]+)$/.exec(String(header || ''));
  return !!m && secretMatches(m[1], token);
}

// Per-IP failure lockout. In-memory only: an app restart resets it.
// `isLocked` must be checked BEFORE comparing the token, so a locked IP learns
// nothing (not even timing) about the token.
function createLockout({
  maxFailures = 5,
  blockMs = 15 * 60 * 1000,
  maxEntries = 10000,
  now = Date.now,
} = {}) {
  // ip -> { failures: number[] (timestamps), lockedUntil: number }
  const entries = new Map();

  function prune(t) {
    for (const [ip, e] of entries) {
      e.failures = e.failures.filter((ts) => t - ts <= blockMs);
      if (!e.failures.length && e.lockedUntil <= t) entries.delete(ip);
    }
  }

  return {
    isLocked(ip) {
      const e = entries.get(ip);
      return !!e && e.lockedUntil > now();
    },
    recordFailure(ip) {
      const t = now();
      if (!entries.has(ip) && entries.size >= maxEntries) {
        prune(t);
        // Still full: evict the oldest entry (Map keeps insertion order).
        if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      }
      const e = entries.get(ip) || { failures: [], lockedUntil: 0 };
      e.failures = e.failures.filter((ts) => t - ts <= blockMs);
      e.failures.push(t);
      if (e.failures.length >= maxFailures) {
        e.lockedUntil = t + blockMs;
        e.failures = [];
      }
      entries.set(ip, e);
    },
    recordSuccess(ip) {
      entries.delete(ip);
    },
    size() {
      return entries.size;
    },
  };
}

// Node's X509Certificate.fingerprint256 is "AB:CD:..."; the QR and the phone
// use the bare lowercase hex form.
function normalizeFingerprint(fp) {
  return String(fp || '').replace(/:/g, '').toLowerCase();
}

function validatePairing(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Pairing payload is not an object.');
  if (p.v !== 1) throw new Error(`Unsupported pairing version: ${p.v}`);
  const m = WSS_URL.exec(String(p.url));
  if (!m || +m[2] < 1 || +m[2] > 65535) throw new Error('Pairing url must be wss://host:port.');
  if (!HEX64.test(String(p.token))) throw new Error('Pairing token must be 64 hex chars.');
  if (!HEX64.test(String(p.certSha256))) throw new Error('Pairing certSha256 must be 64 lowercase hex chars.');
  // Fixed key order so encoding is deterministic.
  return { v: 1, url: p.url, token: p.token, certSha256: p.certSha256 };
}

function encodePairing(payload) {
  const p = validatePairing(payload);
  return PAIRING_PREFIX + Buffer.from(JSON.stringify(p)).toString('base64url');
}

function decodePairing(encoded) {
  const s = String(encoded || '');
  if (!s.startsWith(PAIRING_PREFIX)) throw new Error('Not a Command Center pairing code.');
  let obj;
  try {
    obj = JSON.parse(Buffer.from(s.slice(PAIRING_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    throw new Error('Pairing code is corrupt.');
  }
  return validatePairing(obj);
}

module.exports = {
  generateToken,
  checkBearer,
  createLockout,
  normalizeFingerprint,
  encodePairing,
  decodePairing,
  PAIRING_PREFIX,
};
