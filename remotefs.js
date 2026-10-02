'use strict';

// Folder browsing for the phone app (Add project / New workspace replace the
// desktop's native folder picker). Folders only: never file names or contents.
// A paired phone can already run commands through its agents, so listing
// folder names stays within the remote-access trust model.

const fs = require('fs');
const os = require('os');
const path = require('path');

async function isDirectory(p) {
  try {
    return (await fs.promises.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// Existing drive roots (Windows) or "/" elsewhere.
async function driveRoots() {
  if (process.platform !== 'win32') return ['/'];
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const found = await Promise.all(letters.map(async (l) => ((await isDirectory(`${l}:\\`)) ? `${l}:\\` : null)));
  return found.filter(Boolean);
}

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/**
 * No path: the starting points (home + drives). Otherwise the folder's
 * subfolders, hidden ones (".git", ".vscode") left out.
 * @returns {Promise<{path: string|null, parent: string|null, dirs: string[]}>}
 */
async function listDirs(p) {
  if (!p) return { path: null, parent: null, dirs: [os.homedir(), ...(await driveRoots())] };
  const dir = path.resolve(p);
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw new Error('Folder not found.');
    if (err.code === 'EPERM' || err.code === 'EACCES') throw new Error('No access to this folder.');
    throw err;
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort(byName);
  const up = path.dirname(dir);
  return { path: dir, parent: up === dir ? null : up, dirs };
}

module.exports = { listDirs, isDirectory };
