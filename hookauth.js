'use strict';

// ---------------------------------------------------------------------------
// Hook-server auth helpers. No electron dependency so they can be unit tested
// (see test/hookauth.test.js). Each spawned agent gets a per-agent token derived
// from the per-run master secret; the server verifies the token belongs to the
// agentId in the request, which stops one agent forging another's events.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

// Per-agent token = HMAC(agentId, master). Deterministic for a given master+id,
// but not computable without the master, so an agent can't derive another's.
function agentSecret(master, id) {
  return crypto.createHmac('sha256', master).update(String(id)).digest('hex');
}

// Constant-time compare, guarded for length mismatch (timingSafeEqual throws on
// unequal-length buffers).
function secretMatches(got, expected) {
  const a = Buffer.from(String(got || ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Does a settings.hooks[event] array already contain a report.js command? Used to
// detect a (possibly partial) prior install without a blunt whole-blob search.
function eventHasReport(entries) {
  return (entries || []).some((e) =>
    (e.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes('report.js'))
  );
}

module.exports = { agentSecret, secretMatches, eventHasReport };
