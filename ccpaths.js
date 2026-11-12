'use strict';

// ---------------------------------------------------------------------------
// Default worktree/workspace roots and the path helpers around them.
//
// Electron-free (node built-ins + jsonstore only) so it runs under plain
// `node --test`. main.js uses it for the Settings roots and the folder-picker
// defaults; ccommand.js uses it to check `/command` targets.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { readJsonSafe, writeJsonAtomic } = require('./jsonstore');

const WIN = process.platform === 'win32';

const ROOT_DEFAULTS = Object.freeze({ worktreeRoot: '', workspaceRoot: '' });
const ROOT_LABELS = { worktreeRoot: 'Worktrees folder', workspaceRoot: 'Workspaces folder' };

// Same shell metacharacters as jsonstore.hasShellMeta; a local copy so the
// error can name the character that matched.
const SHELL_META_GLOBAL = /[&|;<>()!^%$"'`\n\r]/;

// Comparison key: like main.js normPath (resolved, case-insensitive on
// Windows), but an existing path is first expanded with realpath.native, so
// an 8.3 short name (C:\Users\OLIVIE~1\...) and its long form compare equal.
function normPath(p) {
  let resolved = path.resolve(String(p));
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    /* missing path: compare its resolved spelling */
  }
  return WIN ? resolved.toLowerCase() : resolved;
}

// One spelling for a path that may arrive as `C:/x`, `c:\x\`, an 8.3 short
// name or (from Git Bash) `/c/x`. MSYS paths are rejected rather than guessed
// at: the caller should pass a Windows path. Existing paths are expanded with
// realpath.native, which also restores the real casing on Windows.
function canonicalPath(p) {
  if (typeof p !== 'string' || !p) throw new Error('Expected a non-empty path.');
  if (WIN && /^\/[a-zA-Z](\/|$)/.test(p)) {
    throw new Error(`"${p}" is an MSYS path; pass a Windows path like C:\\... instead (in Git Bash: cygpath -w).`);
  }
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

// Strict descendant: `p` is inside `root`, not equal to it.
function isUnder(root, p) {
  if (!root || !p) return false;
  const r = normPath(root);
  const t = normPath(p);
  const rel = path.relative(r, t);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isSameOrUnder(root, p) {
  return normPath(root) === normPath(p) || isUnder(root, p);
}

function isDirectChild(root, p) {
  if (!root || !p) return false;
  return normPath(path.dirname(path.resolve(String(p)))) === normPath(root) && normPath(p) !== normPath(root);
}

function repoFolderName(dir) {
  return path.basename(path.resolve(String(dir)));
}

// Where the "Create branch" folder dialog opens for a project: <root>/<repo>.
function worktreePickerDir(root, dir) {
  if (!root) return null;
  return path.join(root, repoFolderName(dir));
}

// Checks one root value; returns the canonical path, '' to unset, or throws
// with a message that names the setting and the failing rule.
function checkRoot(key, value, { isDirectory, home, projects }) {
  const label = ROOT_LABELS[key];
  if (typeof value !== 'string') throw new Error(`${label}: expected a folder path.`);
  if (value === '') return '';
  if (!path.isAbsolute(value)) throw new Error(`${label}: "${value}" is not an absolute path.`);
  const meta = value.match(SHELL_META_GLOBAL);
  if (meta) {
    const ch = meta[0] === '\n' ? '\\n' : meta[0] === '\r' ? '\\r' : meta[0];
    throw new Error(`${label}: the path contains the character "${ch}", which isn't allowed in a folder path here.`);
  }
  const canon = canonicalPath(value);
  if (!isDirectory(canon)) throw new Error(`${label}: "${canon}" does not exist or is not a folder.`);
  if (canon === path.parse(canon).root) throw new Error(`${label}: a drive root can't be used.`);
  if (home && normPath(canon) === normPath(home)) throw new Error(`${label}: the home folder can't be used.`);
  const proj = (projects || []).find((p) => p && typeof p.dir === 'string' && isSameOrUnder(p.dir, canon));
  if (proj) throw new Error(`${label}: "${canon}" is inside the registered project "${proj.name || proj.dir}".`);
  return canon;
}

// Validates a Settings patch against the current roots. Returns
// `{ ok: true, roots }` with both keys in canonical form, or
// `{ ok: false, error }`. Keys other than the two roots are ignored.
function validateRootsPatch(patch, { isDirectory, home, projects, current } = {}) {
  const roots = { ...ROOT_DEFAULTS, ...(current || {}) };
  const deps = { isDirectory, home, projects };
  try {
    for (const key of Object.keys(ROOT_DEFAULTS)) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, key)) roots[key] = checkRoot(key, patch[key], deps);
    }
    const { worktreeRoot: wt, workspaceRoot: ws } = roots;
    if (wt && ws) {
      if (normPath(wt) === normPath(ws)) throw new Error('Worktrees folder and Workspaces folder must not be the same folder.');
      if (isUnder(wt, ws)) throw new Error('Workspaces folder must not be inside the Worktrees folder.');
      if (isUnder(ws, wt)) throw new Error('Worktrees folder must not be inside the Workspaces folder.');
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return { ok: true, roots: { worktreeRoot: roots.worktreeRoot, workspaceRoot: roots.workspaceRoot } };
}

function pickRoots(obj) {
  const out = { ...ROOT_DEFAULTS };
  for (const key of Object.keys(ROOT_DEFAULTS)) {
    if (obj && typeof obj[key] === 'string') out[key] = obj[key];
  }
  return out;
}

// `{ roots }`, or `{ roots: defaults, error }` when the file is unreadable
// (readJsonSafe has already backed it up). Never throws.
function loadRoots(file) {
  try {
    return { roots: pickRoots(readJsonSafe(file, {})) };
  } catch (err) {
    return { roots: { ...ROOT_DEFAULTS }, error: err.message };
  }
}

function saveRoots(file, roots) {
  writeJsonAtomic(file, pickRoots(roots));
}

module.exports = {
  ROOT_DEFAULTS,
  normPath,
  canonicalPath,
  validateRootsPatch,
  repoFolderName,
  worktreePickerDir,
  isUnder,
  isDirectChild,
  loadRoots,
  saveRoots,
};
