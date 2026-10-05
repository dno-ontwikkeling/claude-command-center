'use strict';

// ---------------------------------------------------------------------------
// Project docs for the docs viewer panel: list and read the .md / .html files in
// <cwd>/plans and <cwd>/reviews. No electron dependency (fs/path only) so it can
// be unit tested under `node --test` (see test/docs.test.js). main.js exposes
// listDocs/readDoc over IPC. readDoc never throws and only ever reads direct
// children of the two allowed folders (no traversal, no symlink escape).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const DOC_KINDS = ['plans', 'reviews'];
const DOC_EXTS = new Set(['.md', '.html']);
const MAX_DOC_BYTES = 2 * 1024 * 1024;

// Folders shown when a project has no docFolders of its own.
const DEFAULT_FOLDERS = Object.freeze(['plans', 'reviews']);
const MAX_FOLDERS = 20;

// Validate a per-project folder list (from the Folders overlay or a stored
// record). Entries are relative to the project, '/' separated, '.' for the root.
// Anything that could leave the project is rejected, as is a folder named
// `archive`: each folder's archive/ is listed automatically, so allowing it as
// a folder of its own would list the same files twice. Never throws.
// Returns { ok: true, folders } or { ok: false, error }.
function normalizeFolders(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'Folders must be a list' };
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (typeof raw !== 'string') return { ok: false, error: 'Invalid folder' };
    const f = raw.trim().replace(/\\/g, '/').replace(/\/+$/, '').replace(/^\.\//, '') || '.';
    const segs = f.split('/');
    const escapes =
      f.startsWith('/') ||
      /^[a-z]:/i.test(f) ||
      f.includes('\0') ||
      (f !== '.' && segs.some((s) => s === '' || s === '.' || s === '..'));
    if (escapes) return { ok: false, error: `Folder must be inside the project: ${raw}` };
    if (segs[segs.length - 1].toLowerCase() === 'archive') {
      return { ok: false, error: 'archive/ folders are listed automatically' };
    }
    const key = f.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  if (out.length > MAX_FOLDERS) return { ok: false, error: `At most ${MAX_FOLDERS} folders` };
  return { ok: true, folders: out.length ? out : [...DEFAULT_FOLDERS] };
}

// Same comparison as main.js normPath: resolved, case-insensitive on Windows.
function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const norm = (p) => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

// The doc folders of the project/workspace record for `dir`. The config lives
// on the record itself (projects.json / workspaces.json), so removing the
// record removes the config with it. A stored list is re-validated on every
// read: a hand-edited or corrupt value falls back to the defaults and comes
// back flagged `invalid` so the caller can log it.
function docFoldersFor(records, dir) {
  const rec = records.find((r) => samePath(r.dir, dir));
  if (!rec || rec.docFolders === undefined) return { folders: [...DEFAULT_FOLDERS], invalid: false };
  const n = normalizeFolders(rec.docFolders);
  return n.ok ? { folders: n.folders, invalid: false } : { folders: [...DEFAULT_FOLDERS], invalid: true };
}

// A copy of `records` with `folders` stored on the record for `dir`. Saving
// the defaults drops the field, so an untouched project stays byte-identical.
// `folders` must already be normalized. Returns { ok, records } or { ok, error }.
function withDocFolders(records, dir, folders) {
  if (!records.some((r) => samePath(r.dir, dir))) return { ok: false, error: 'Unknown project' };
  const isDefault = folders.length === DEFAULT_FOLDERS.length && folders.every((f, i) => f === DEFAULT_FOLDERS[i]);
  return {
    ok: true,
    records: records.map((r) => {
      if (!samePath(r.dir, dir)) return r;
      const { docFolders: _old, ...rest } = r;
      return isDefault ? rest : { ...rest, docFolders: [...folders] };
    }),
  };
}

// All .md/.html files directly inside <cwd>/plans and <cwd>/reviews, newest first.
// Missing or unreadable folders just contribute nothing.
async function listDocs(cwd) {
  const out = [];
  for (const kind of DOC_KINDS) {
    let names;
    try {
      names = await fs.promises.readdir(path.join(cwd, kind));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!DOC_EXTS.has(path.extname(name).toLowerCase())) continue;
      try {
        const st = await fs.promises.stat(path.join(cwd, kind, name));
        if (!st.isFile()) continue;
        out.push({ rel: `${kind}/${name}`, kind, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // vanished or broken symlink: skip
      }
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

// True when `child` is `parent` itself or lives beneath it.
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Read one doc. Returns { ok: true, html } (markdown rendered, html unchanged)
// or { ok: false, error }. Never throws.
async function readDoc(cwd, rel) {
  try {
    if (typeof rel !== 'string' || !rel) return { ok: false, error: 'Invalid path' };
    // Accept both separators so a backslash form of '..' cannot slip through.
    const parts = rel.split(/[\\/]/);
    if (parts.length !== 2 || !DOC_KINDS.includes(parts[0])) {
      return { ok: false, error: 'Only files in plans/ or reviews/ can be opened' };
    }
    const [kind, name] = parts;
    if (!name || name === '.' || name === '..' || /[:\0]/.test(name)) {
      return { ok: false, error: 'Invalid file name' };
    }
    const ext = path.extname(name).toLowerCase();
    if (!DOC_EXTS.has(ext)) return { ok: false, error: 'Only .md and .html files can be opened' };

    const root = await fs.promises.realpath(path.join(cwd, kind));
    const file = await fs.promises.realpath(path.join(cwd, kind, name));
    if (!isInside(root, file) || file === root) {
      return { ok: false, error: 'File is outside the docs folder' };
    }
    const st = await fs.promises.stat(file);
    if (!st.isFile()) return { ok: false, error: 'Not a file' };
    if (st.size > MAX_DOC_BYTES) return { ok: false, error: 'File is larger than 2 MB' };

    const text = await fs.promises.readFile(file, 'utf8');
    return { ok: true, html: ext === '.md' ? marked.parse(text) : text };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'Could not read file' };
  }
}

module.exports = { listDocs, readDoc, normalizeFolders, DEFAULT_FOLDERS, docFoldersFor, withDocFolders };
