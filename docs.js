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
// docAction's 'browser' action opens the shown doc in the default browser: an
// .html doc as the file itself, a .md/.txt doc rendered to a standalone page in
// a temp folder first (see browserPage).
//
// `cfg` below is a project's docs config: { folders, exts }.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
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

// The viewer's limits for a resolved doc: a regular file of at most 2 MB.
// Returns { ok: true } or { ok: false, error }. Throws on fs errors.
async function checkDoc(r) {
  const st = await fs.promises.stat(r.file);
  if (!st.isFile()) return { ok: false, error: 'Not a file' };
  if (st.size > MAX_DOC_BYTES) return { ok: false, error: 'File is larger than 2 MB' };
  return { ok: true };
}

// Body html of a resolved doc, within the viewer's limits.
// Returns { ok: true, html } or { ok: false, error }. Never throws.
async function readResolved(r) {
  try {
    const c = await checkDoc(r);
    if (!c.ok) return c;
    const text = await fs.promises.readFile(r.file, 'utf8');
    return { ok: true, html: toHtml(path.extname(r.name).toLowerCase(), text) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'Could not read file' };
  }
}

// Read one doc. Returns { ok: true, html } or { ok: false, error }. Never throws.
async function readDoc(cwd, cfg, rel) {
  const r = await resolveDoc(cwd, cfg, rel);
  if (!r.ok) return r;
  return readResolved(r);
}

// Readable defaults for the browser page. Keep in step with BASE_CSS in
// renderer/docs-view.mjs (the in-app look). Not imported from there, so the
// main process never depends on renderer code.
const BROWSER_CSS = `
:root { color-scheme: light dark; --fg: #1f2328; --bg: #ffffff; --muted: #59636e; --border: #d1d9e0; --elevated: #f6f8fa; --link: #0969da; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6e8eb; --bg: #15191c; --muted: #9aa4ae; --border: #30363d; --elevated: #1e2428; --link: #6cb6ff; }
}
body { margin: 0 auto; max-width: 860px; padding: 32px 24px 64px; background: var(--bg); color: var(--fg);
  font: 15px/1.6 'Segoe UI', system-ui, sans-serif; overflow-wrap: break-word; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.5em; font-weight: 600; }
h1 { font-size: 1.8em; margin-top: 0; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
h2 { font-size: 1.4em; padding-bottom: 0.25em; border-bottom: 1px solid var(--border); }
p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
ul, ol { padding-left: 1.6em; }
a { color: var(--link); }
hr { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }
blockquote { padding: 0 1em; color: var(--muted); border-left: 3px solid var(--border); }
code, pre { font-family: 'Cascadia Mono', Consolas, monospace; font-size: 0.9em; }
code { background: var(--elevated); padding: 0.15em 0.35em; border-radius: 4px; }
pre { background: var(--elevated); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; overflow-x: auto; }
pre code { background: none; padding: 0; }
pre.plain { white-space: pre-wrap; background: none; border: 0; padding: 0; font-size: 0.95em; }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 6px 12px; text-align: left; }
th { background: var(--elevated); font-weight: 600; }
img { max-width: 100%; }
`;

// Scripts, frames and forms are blocked: rendered markdown is not sanitized.
// Images may load (local ones through <base>, plus data: and https:).
const BROWSER_CSP = "default-src 'none'; img-src file: data: https:; style-src 'unsafe-inline'; form-action 'none'";

// DEFERRED (2026-11-12): two limits left out of the open-in-browser slice.
// - Relative links to other .md docs point at the raw .md, which the OS hands
//   to its .md app. Fixing it means rewriting links and pre-rendering the
//   linked docs.
// - The page follows prefers-color-scheme, not the app's data-theme. Fixing it
//   means the renderer passing its theme through docs:action.
// Neither was requested; each is its own slice if wanted.
//
// Standalone page for a rendered doc. `dir` is the folder the doc sits in, so
// its relative images and links resolve there (the trailing separator makes
// the base that folder, not its parent).
function browserPage(name, dir, bodyHtml) {
  const base = pathToFileURL(dir + path.sep).href;
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${BROWSER_CSP}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(name)}</title>` +
    `<base href="${escapeHtml(base)}">` +
    `<style>${BROWSER_CSS}</style>` +
    `</head><body>${bodyHtml}</body></html>\n`
  );
}

const MAX_STEM = 60;

// '<stem>-<hash8>.html' for the doc at real path `file`. The hash keeps docs
// of the same name in different folders apart, and reopening a doc reuses
// (overwrites) its page. The stem is capped to stay clear of MAX_PATH.
function tempPageName(name, file) {
  const stem = name.slice(0, name.length - path.extname(name).length).slice(0, MAX_STEM);
  const hash = crypto.createHash('sha1').update(file).digest('hex').slice(0, 8);
  return `${stem}-${hash}.html`;
}

// Open a resolved doc through ops.openInBrowser(path): an .html doc as the
// file itself, anything else rendered into ops.tempDir first. Never throws.
async function openInBrowser(r, ops) {
  try {
    if (path.extname(r.name).toLowerCase() === '.html') {
      const c = await checkDoc(r);
      if (!c.ok) return c;
      await ops.openInBrowser(r.file);
      return { ok: true };
    }
    const doc = await readResolved(r);
    if (!doc.ok) return doc;
    await fs.promises.mkdir(ops.tempDir, { recursive: true });
    const page = path.join(ops.tempDir, tempPageName(r.name, r.file));
    await fs.promises.writeFile(page, browserPage(r.name, path.dirname(r.file), doc.html), 'utf8');
    await ops.openInBrowser(page);
    return { ok: true };
  } catch (e) {
    if (e && e.code === 'ENOENT' && e.path === r.file) return { ok: false, error: `${r.name} no longer exists` };
    return { ok: false, error: `Could not open ${r.name} in the browser: ${(e && e.message) || 'unknown error'}` };
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

const OS_ACTIONS = new Set(['open', 'reveal', 'trash', 'browser']);

// The docs:action dispatch. The OS calls are injected (main.js passes
// electron's shell and the editors.js launcher) so this stays testable; each
// receives the resolved real path only, never the renderer's `rel`.
//   ops: { trashItem(file), showItemInFolder(file), openInEditor(file) -> { ok } | { error },
//          openInBrowser(file) -> Promise (rejects on failure), tempDir: folder for rendered pages }
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
    if (action === 'browser') return await openInBrowser(r, ops);
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
