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

const DOC_EXTS = new Set(['.md', '.html']);
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const MAX_PER_DIR = 500;
const MAX_TOTAL = 1000;

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

// Path of a doc relative to cwd, '/' separated: relFor('plans', true, 'a.md')
// is 'plans/archive/a.md', relFor('.', false, 'README.md') is 'README.md'.
function relFor(folder, archived, name) {
  return [folder === '.' ? '' : folder, archived ? 'archive' : '', name].filter(Boolean).join('/');
}

// All .md/.html files directly inside each folder and inside its archive/,
// newest first. Never recursive, so '.' lists root files only. Missing or
// unreadable folders contribute nothing. Capped per directory and in total:
// the panel polls this once a second.
async function listDocs(cwd, folders = DEFAULT_FOLDERS) {
  const out = [];
  for (const folder of folders) {
    for (const archived of [false, true]) {
      const dir = path.join(cwd, relFor(folder, archived, ''));
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      let n = 0;
      for (const e of entries) {
        if (n >= MAX_PER_DIR || out.length >= MAX_TOTAL) break;
        if (e.isDirectory() || !DOC_EXTS.has(path.extname(e.name).toLowerCase())) continue;
        try {
          const st = await fs.promises.stat(path.join(dir, e.name));
          if (!st.isFile()) continue;
          out.push({ rel: relFor(folder, archived, e.name), folder, archived, mtimeMs: st.mtimeMs, size: st.size });
          n++;
        } catch {
          // vanished or broken symlink: skip
        }
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

const OUTSIDE = 'File is outside the docs folders';

// The one path guard. Every read and every action resolves `rel` here first.
// `rel` must be '<folder>/<name>' or '<folder>/archive/<name>' for a configured
// folder ('<name>' / 'archive/<name>' for '.'), with a .md/.html name. Real
// paths must nest: the folder inside cwd, the archive/ inside the folder, the
// file inside its directory, so no symlink or junction anywhere on the way can
// lead out. Returns { ok: true, file, folder, archived, name, folderReal } or
// { ok: false, error }. Never throws.
async function resolveDoc(cwd, folders = DEFAULT_FOLDERS, rel) {
  try {
    if (typeof rel !== 'string' || !rel) return { ok: false, error: 'Invalid path' };
    // Accept both separators so a backslash form of '..' cannot slip through.
    const parts = rel.split(/[\\/]/);
    const name = parts.pop();
    if (!name || name === '.' || name === '..' || /[:\0]/.test(name) || parts.includes('..')) {
      return { ok: false, error: 'Invalid file name' };
    }
    if (!DOC_EXTS.has(path.extname(name).toLowerCase())) {
      return { ok: false, error: 'Only .md and .html files can be opened' };
    }
    let folder = folders.find((f) => f === (parts.join('/') || '.'));
    let archived = false;
    if (!folder && parts[parts.length - 1] === 'archive') {
      folder = folders.find((f) => f === (parts.slice(0, -1).join('/') || '.'));
      archived = !!folder;
    }
    if (!folder) return { ok: false, error: OUTSIDE };

    const root = await fs.promises.realpath(cwd);
    const folderReal = await fs.promises.realpath(path.join(root, folder));
    if (!isInside(root, folderReal)) return { ok: false, error: OUTSIDE };
    const dirReal = archived ? await fs.promises.realpath(path.join(folderReal, 'archive')) : folderReal;
    if (!isInside(folderReal, dirReal)) return { ok: false, error: OUTSIDE };
    const file = await fs.promises.realpath(path.join(dirReal, name));
    if (!isInside(dirReal, file) || file === dirReal) return { ok: false, error: OUTSIDE };
    return { ok: true, file, folder, archived, name, folderReal };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, error: `${path.basename(String(rel))} no longer exists` };
    return { ok: false, error: (e && e.message) || 'Could not open file' };
  }
}

// Read one doc. Returns { ok: true, html } (markdown rendered, html unchanged)
// or { ok: false, error }. Never throws.
async function readDoc(cwd, folders, rel) {
  const r = await resolveDoc(cwd, folders, rel);
  if (!r.ok) return r;
  try {
    const st = await fs.promises.stat(r.file);
    if (!st.isFile()) return { ok: false, error: 'Not a file' };
    if (st.size > MAX_DOC_BYTES) return { ok: false, error: 'File is larger than 2 MB' };
    const text = await fs.promises.readFile(r.file, 'utf8');
    return { ok: true, html: path.extname(r.name).toLowerCase() === '.md' ? marked.parse(text) : text };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'Could not read file' };
  }
}

module.exports = {
  listDocs,
  readDoc,
  resolveDoc,
  normalizeFolders,
  DEFAULT_FOLDERS,
  docFoldersFor,
  withDocFolders,
};
