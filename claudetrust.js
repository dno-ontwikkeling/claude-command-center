'use strict';

// ---------------------------------------------------------------------------
// Pre-accept Claude Code's "trust this folder?" prompt for folders Command
// Center spawns sessions into, by setting
// `projects["<key>"].hasTrustDialogAccepted = true` in ~/.claude.json.
//
// Claude Code shows that prompt even in bypass mode, and holds the positional
// first prompt until it is answered, so a spawned session would otherwise sit
// waiting. Running Claude sessions rewrite ~/.claude.json too, so this reads
// the file right before writing, only adds missing flags, writes atomically,
// and never writes a file it could not parse.
//
// Electron-free and logger-free so it runs under plain `node --test`.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./jsonstore');

const WIN = process.platform === 'win32';

// Claude's key spelling: forward slashes, casing kept, upper-case drive
// letter, no trailing separator (`C:/Github/Lansweeper.Packet`).
function trustKey(p) {
  let r = path.resolve(String(p)).replace(/\\/g, '/');
  if (WIN && /^[a-z]:/.test(r)) r = r[0].toUpperCase() + r.slice(1);
  if (r.length > 1 && r.endsWith('/') && !/^[A-Za-z]:\/$/.test(r)) r = r.slice(0, -1);
  return r;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Returns `{ ok: true, changed: [keys] }` or `{ ok: false, error }`.
function ensureTrusted(file, paths) {
  const wanted = [];
  for (const p of paths || []) {
    if (typeof p !== 'string' || !p) continue;
    const k = trustKey(p);
    if (!wanted.includes(k)) wanted.push(k);
  }
  if (!wanted.length) return { ok: true, changed: [] };

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { ok: false, error: `Could not read ${file}: ${err.message}` };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `Could not parse ${file}: ${err.message}` };
  }
  if (!isObject(json)) return { ok: false, error: `${file} is not a JSON object.` };
  if (json.projects !== undefined && !isObject(json.projects)) {
    return { ok: false, error: `${file}: "projects" is not an object.` };
  }

  const projects = json.projects || {};
  const same = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
  const changed = [];
  for (const key of wanted) {
    const trusted = Object.keys(projects).some(
      (k) => same(k, key) && isObject(projects[k]) && projects[k].hasTrustDialogAccepted === true
    );
    if (trusted) continue;
    const entry = isObject(projects[key]) ? projects[key] : {};
    projects[key] = { ...entry, hasTrustDialogAccepted: true };
    changed.push(key);
  }
  if (!changed.length) return { ok: true, changed };

  json.projects = projects;
  try {
    writeJsonAtomic(file, json);
  } catch (err) {
    return { ok: false, error: `Could not write ${file}: ${err.message}` };
  }
  return { ok: true, changed };
}

module.exports = { trustKey, ensureTrusted };
