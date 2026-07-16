'use strict';

// ---------------------------------------------------------------------------
// Tiny shared helpers with no other home. Electron-free so both main.js and
// editors.js (and any other electron-free module) can require it.
// ---------------------------------------------------------------------------

// Best-effort human-readable message from a caught value: an Error's
// `.message`, or the value itself stringified (e.g. a plain string throw).
function errMsg(err) {
  return String((err && err.message) || err);
}

module.exports = { errMsg };
