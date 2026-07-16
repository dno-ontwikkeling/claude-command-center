'use strict';

// ---------------------------------------------------------------------------
// Crash/corruption-resistant JSON IO + path-safety helpers.
//
// Extracted from main.js so it has NO electron/DOM dependency and can be unit
// tested directly under `node --test`. main.js requires this module; the tests
// in test/jsonstore.test.js exercise it against real temp files.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

// Copy a bad/unreadable file aside so it is never silently lost when we later
// refuse to overwrite it. Returns the backup path, or null if even the copy
// failed. Best-effort: a failed backup must not mask the original error.
// De-duped per file: loaders run on a 15s poll, so without this a persistently
// corrupt file would spawn a new .bak-<ts> copy every tick.
const backedUpFiles = new Map(); // file -> backup path (this session)
function backupBadFile(file) {
  if (backedUpFiles.has(file)) return backedUpFiles.get(file);
  try {
    const bak = `${file}.bak-${Date.now()}`;
    fs.copyFileSync(file, bak);
    backedUpFiles.set(file, bak);
    return bak;
  } catch {
    return null;
  }
}

// Read + parse JSON, distinguishing "file does not exist yet" (genuine first
// run -> return `fallback`) from a corrupt/truncated/permission-failed read. In
// the latter case we must NOT return the fallback: a caller would then save()
// over the file and permanently destroy recoverable data. Instead back up the
// bad file and throw so the caller aborts before any write.
function readJsonSafe(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    const bak = backupBadFile(file);
    throw new Error(`Could not read ${file}: ${err.message}${bak ? ` (backed up to ${bak})` : ''}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const bak = backupBadFile(file);
    throw new Error(`Could not parse ${file}: ${err.message}${bak ? ` (backed up to ${bak})` : ''}`);
  }
}

// Write JSON atomically: serialize to a temp file in the same directory, then
// rename over the target. rename is atomic on the same filesystem, so a crash
// or power loss mid-write can never leave a truncated live file (which the
// readers above would otherwise treat as corrupt). On failure the live file is
// untouched and the orphaned temp is cleaned up before rethrowing.
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* temp already gone or unremovable — nothing more to do */
    }
    throw err;
  }
}

// Shell / command metacharacters that must never end up in a folder name: the
// name is later baked into a filesystem path that gets handed to launchers
// (VS Code via cmd.exe, git). Rejecting them at creation time is defence-in-depth
// on top of launching with explicit quoting.
const SHELL_META = /[&|;<>()!^%$"'`\n\r]/;
function hasShellMeta(name) {
  return SHELL_META.test(String(name));
}

module.exports = { backupBadFile, readJsonSafe, writeJsonAtomic, hasShellMeta };
