'use strict';

// ---------------------------------------------------------------------------
// Project docs for the docs viewer panel: list and read the doc files in a
// project's configured folders (<cwd>/plans and <cwd>/reviews by default) with
// its configured extensions (.md and .html by default, .txt optional). No
// electron dependency (fs/path only) so it can be unit tested under
// `node --test` (see test/docs.test.js). main.js exposes listDocs/readDoc over
// IPC. readDoc never throws and only ever reads direct children of the
// configured folders (no traversal, no symlink escape).
//
// `cfg` below is a project's docs config: { folders, exts }.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

// File types the viewer can render, and the ones listed when a project has no
// docExts of its own.
const SUPPORTED_EXTS = Object.freeze(['.md', '.html', '.txt']);
const DEFAULT_EXTS = Object.freeze(['.md', '.html']);
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const MAX_PER_DIR = 500;
const MAX_TOTAL = 1000;

// Folders shown when a project has no docFolders of its own.
const DEFAULT_FOLDERS = Object.freeze(['plans', 'reviews']);
const MAX_FOLDERS = 20;

const DEFAULT_CONFIG = Object.freeze({ folders: DEFAULT_FOLDERS, exts: DEFAULT_EXTS });

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

// Validate a per-project file type list: a non-empty subset of SUPPORTED_EXTS,
// with or without the dot, any case. Returned in SUPPORTED_EXTS order so equal
// sets compare equal. Never throws. Returns { ok: true, exts } or { ok: false, error }.
function normalizeExts(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'File types must be a list' };
  const picked = new Set();
  for (const raw of input) {
    if (typeof raw !== 'string') return { ok: false, error: 'Invalid file type' };
    const e = raw.trim().toLowerCase();
    const ext = e.startsWith('.') ? e : `.${e}`;
    if (!SUPPORTED_EXTS.includes(ext)) return { ok: false, error: `Unsupported file type: ${raw}` };
    picked.add(ext);
  }
  if (!picked.size) return { ok: false, error: 'Pick at least one file type' };
  return { ok: true, exts: SUPPORTED_EXTS.filter((x) => picked.has(x)) };
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Same comparison as main.js normPath: resolved, case-insensitive on Windows.
function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const norm = (p) => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

// The docs config ({ folders, exts }) of the project/workspace record for
// `dir`. It lives on the record itself (docFolders / docExts in projects.json
// or workspaces.json), so removing the record removes the config with it.
// Stored values are re-validated on every read: a hand-edited or corrupt one
// falls back to its default and comes back flagged `invalid` so the caller
// can log it.
function docConfigFor(records, dir) {
  const rec = records.find((r) => samePath(r.dir, dir));
  let folders = [...DEFAULT_FOLDERS];
  let exts = [...DEFAULT_EXTS];
  let invalid = false;
  if (rec && rec.docFolders !== undefined) {
    const n = normalizeFolders(rec.docFolders);
    if (n.ok) folders = n.folders;
    else invalid = true;
  }
  if (rec && rec.docExts !== undefined) {
    const n = normalizeExts(rec.docExts);
    if (n.ok) exts = n.exts;
    else invalid = true;
  }
  return { folders, exts, invalid };
}

// A copy of `records` with `cfg` stored on the record for `dir`. A default
// value drops its field, so an untouched project stays byte-identical.
// `cfg` must already be normalized. Returns { ok, records } or { ok, error }.
function withDocConfig(records, dir, { folders, exts }) {
  if (!records.some((r) => samePath(r.dir, dir))) return { ok: false, error: 'Unknown project' };
  return {
    ok: true,
    records: records.map((r) => {
      if (!samePath(r.dir, dir)) return r;
      const { docFolders: _f, docExts: _e, ...rest } = r;
      return {
        ...rest,
        ...(sameList(folders, DEFAULT_FOLDERS) ? {} : { docFolders: [...folders] }),
        ...(sameList(exts, DEFAULT_EXTS) ? {} : { docExts: [...exts] }),
      };
    }),
  };
}

// Path of a doc relative to cwd, '/' separated: relFor('plans', true, 'a.md')
// is 'plans/archive/a.md', relFor('.', false, 'README.md') is 'README.md'.
function relFor(folder, archived, name) {
  return [folder === '.' ? '' : folder, archived ? 'archive' : '', name].filter(Boolean).join('/');
}

// All files with a configured extension directly inside each folder and
// inside its archive/, newest first. Never recursive, so '.' lists root files
// only. Missing or unreadable folders contribute nothing. Capped per directory
// and in total: the panel polls this once a second.
async function listDocs(cwd, cfg = DEFAULT_CONFIG) {
  const { folders, exts } = cfg;
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
        if (e.isDirectory() || !exts.includes(path.extname(e.name).toLowerCase())) continue;
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
// folder ('<name>' / 'archive/<name>' for '.'), with a configured extension. Real
// paths must nest: the folder inside cwd, the archive/ inside the folder, the
// file inside its directory, so no symlink or junction anywhere on the way can
// lead out. Returns { ok: true, file, folder, archived, name, folderReal } or
// { ok: false, error }. Never throws.
async function resolveDoc(cwd, cfg = DEFAULT_CONFIG, rel) {
  const { folders, exts } = cfg;
  try {
    if (typeof rel !== 'string' || !rel) return { ok: false, error: 'Invalid path' };
    // Accept both separators so a backslash form of '..' cannot slip through.
    const parts = rel.split(/[\\/]/);
    const name = parts.pop();
    if (!name || name === '.' || name === '..' || /[:\0]/.test(name) || parts.includes('..')) {
      return { ok: false, error: 'Invalid file name' };
    }
    if (!exts.includes(path.extname(name).toLowerCase())) {
      return { ok: false, error: `Only ${exts.join(', ')} files can be opened` };
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

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Doc text as body html: markdown rendered, plain text escaped into a
// wrapping <pre>, html unchanged.
function toHtml(ext, text) {
  if (ext === '.md') return marked.parse(text);
  if (ext === '.txt') return `<pre class="plain">${escapeHtml(text)}</pre>`;
  return text;
}

// Read one doc. Returns { ok: true, html } or { ok: false, error }. Never throws.
async function readDoc(cwd, cfg, rel) {
  const r = await resolveDoc(cwd, cfg, rel);
  if (!r.ok) return r;
  try {
    const st = await fs.promises.stat(r.file);
    if (!st.isFile()) return { ok: false, error: 'Not a file' };
    if (st.size > MAX_DOC_BYTES) return { ok: false, error: 'File is larger than 2 MB' };
    const text = await fs.promises.readFile(r.file, 'utf8');
    return { ok: true, html: toHtml(path.extname(r.name).toLowerCase(), text) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'Could not read file' };
  }
}

// `name`, or 'name (2).ext', 'name (3).ext', … whichever does not exist in
// `dir` yet. lstat, so a dangling symlink still counts as taken. fs.rename on
// Windows replaces an existing target, so this runs right before the move.
async function freeName(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? name : `${stem} (${i})${ext}`;
    try {
      await fs.promises.lstat(path.join(dir, candidate));
    } catch (e) {
      if (e && e.code === 'ENOENT') return candidate;
      throw e;
    }
  }
  throw new Error('too many files with this name');
}

// Move a doc into its folder's archive/ (toArchive) or back out of it.
// Never overwrites: a clash gets a numbered name. No copy-then-delete
// fallback, so a failed move leaves the file where it was.
async function moveDoc(cwd, cfg, rel, toArchive) {
  const r = await resolveDoc(cwd, cfg, rel);
  if (!r.ok) return r;
  if (r.archived === toArchive) return { ok: false, error: toArchive ? 'Already archived' : 'Not archived' };
  const verb = toArchive ? 'archive' : 'restore';
  try {
    let destDir = r.folderReal;
    if (toArchive) {
      await fs.promises.mkdir(path.join(r.folderReal, 'archive'), { recursive: true });
      // an existing archive/ may be a link: it must still sit inside the folder
      destDir = await fs.promises.realpath(path.join(r.folderReal, 'archive'));
      if (!isInside(r.folderReal, destDir) || destDir === r.folderReal) return { ok: false, error: OUTSIDE };
    }
    const name = await freeName(destDir, r.name);
    await fs.promises.rename(r.file, path.join(destDir, name));
    return { ok: true, rel: relFor(r.folder, toArchive, name) };
  } catch (e) {
    return { ok: false, error: `Could not ${verb} ${r.name}: ${(e && e.message) || 'unknown error'}` };
  }
}

const archiveDoc = (cwd, cfg, rel) => moveDoc(cwd, cfg, rel, true);
const restoreDoc = (cwd, cfg, rel) => moveDoc(cwd, cfg, rel, false);

const OS_ACTIONS = new Set(['open', 'reveal', 'trash']);

// The docs:action dispatch. The OS calls are injected (main.js passes
// electron's shell and the editors.js launcher) so this stays testable; each
// receives the resolved real path only, never the renderer's `rel`.
//   ops: { trashItem(file), showItemInFolder(file), openInEditor(file) -> { ok } | { error } }
// Returns { ok: true, rel? } (rel = new location after archive/restore) or
// { ok: false, error }. Never throws.
async function docAction(cwd, cfg, rel, action, ops) {
  if (action === 'archive') return archiveDoc(cwd, cfg, rel);
  if (action === 'restore') return restoreDoc(cwd, cfg, rel);
  if (!OS_ACTIONS.has(action)) return { ok: false, error: 'Unknown action' };
  const r = await resolveDoc(cwd, cfg, rel);
  if (!r.ok) return r;
  try {
    if (action === 'open') {
      const o = await ops.openInEditor(r.file);
      return o && o.error ? { ok: false, error: o.error } : { ok: true };
    }
    if (action === 'reveal') {
      ops.showItemInFolder(r.file);
      return { ok: true };
    }
    // trash: Recycle Bin only. No permanent-delete fallback when it fails.
    try {
      await ops.trashItem(r.file);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Could not move ${r.name} to the Recycle Bin: ${(e && e.message) || 'unknown error'}` };
    }
  } catch (e) {
    return { ok: false, error: (e && e.message) || `Could not ${action} ${r.name}` };
  }
}

module.exports = {
  listDocs,
  readDoc,
  resolveDoc,
  archiveDoc,
  restoreDoc,
  docAction,
  normalizeFolders,
  normalizeExts,
  DEFAULT_FOLDERS,
  DEFAULT_EXTS,
  SUPPORTED_EXTS,
  docConfigFor,
  withDocConfig,
};
