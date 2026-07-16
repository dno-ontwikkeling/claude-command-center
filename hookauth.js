'use strict';

// ---------------------------------------------------------------------------
// Hook-server auth helpers. No electron dependency so they can be unit tested
// (see test/hookauth.test.js). Each spawned agent gets a per-agent token derived
// from the per-run master secret; the server verifies the token belongs to the
// agentId in the request, which stops one agent forging another's events.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const path = require('path');

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

// Resolved path to the hook script this app installs. Mirrors main.js's own
// REPORT_SCRIPT computation (same asar-unpack rewrite) so eventHasReport below
// can match our own hook command by its real path, not a blunt substring.
// Exported as the default/production value of `reportScript`; callers that
// need a different resolved path (e.g. tests) pass their own.
const REPORT_SCRIPT = path
  .join(__dirname, 'hooks', 'report.js')
  .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

// Does a settings.hooks[event] array already contain a command that invokes
// `reportScript` (matched by resolved path, not a blunt "report.js" substring
// search)? Used to detect a (possibly partial) prior install without falsely
// matching some other tool's unrelated report.js hook.
function eventHasReport(entries, reportScript = REPORT_SCRIPT) {
  return (entries || []).some((e) =>
    (e.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(reportScript))
  );
}

module.exports = { agentSecret, secretMatches, eventHasReport, REPORT_SCRIPT };
