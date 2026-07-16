'use strict';

// ---------------------------------------------------------------------------
// Hook-install merge logic for ~/.claude/settings.json — the shared Claude CLI
// config, NOT owned by this app. No electron dependency, so the merge (and the
// corrupt-file abort path) can be unit tested directly (see
// test/hooksmerge.test.js). Dialogs/confirmation prompts and the final
// writeJsonAtomic stay in main.js's ensureHooksInstalled, which orchestrates
// these pure/file-reading helpers.
// ---------------------------------------------------------------------------

const hookAuth = require('./hookauth');
const { readJsonSafe } = require('./jsonstore');

// Load settings.json, distinguishing "missing" (first run -> {}, safe to
// create) from a parse/IO failure the caller must abort on. readJsonSafe
// already backs up a corrupt file and throws; we must never fall back to {}
// here, since a caller write would then wipe the user's real settings.
function loadSettings(file) {
  try {
    const settings = readJsonSafe(file, null); // null sentinel = missing (first run)
    return { ok: true, settings: settings === null ? {} : settings };
  } catch (err) {
    return { ok: false, error: err };
  }
}

// True only when EVERY tracked event already has a report.js command — a
// blunt blob `includes` would treat a partial/interrupted prior install as
// complete and never add the missing events.
function hooksInstalled(settings, hookEvents) {
  const hooks = settings.hooks || {};
  return Object.keys(hookEvents).every((event) => hookAuth.eventHasReport(hooks[event]));
}

// Merge the hooks block into `settings` IN PLACE so every pre-existing key on
// `settings` (permissions, model prefs, unrelated hooks) is preserved. Skips
// any event that already carries a report.js command, so calling this again
// (e.g. on a subsequent app launch) never duplicates an entry. Returns
// `settings` for convenience.
function mergeHooksInto(settings, hookEvents, reportScript) {
  settings.hooks = settings.hooks || {};
  for (const [event, status] of Object.entries(hookEvents)) {
    settings.hooks[event] = settings.hooks[event] || [];
    if (hookAuth.eventHasReport(settings.hooks[event])) continue; // don't duplicate on re-run
    const command = `node "${reportScript}" ${status}`;
    settings.hooks[event].push({ hooks: [{ type: 'command', command }] });
  }
  return settings;
}

module.exports = { loadSettings, hooksInstalled, mergeHooksInto };
