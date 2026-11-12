'use strict';

// Installs, updates and removes the Claude Code skills Command Center ships
// (skills/<name>/SKILL.md → ~/.claude/skills/<name>/SKILL.md).
//
// Ownership marker: a `.command-center.json` sidecar next to each installed
// SKILL.md, holding the sha256 of the SKILL.md bytes CC wrote.
//   sidecar present, hash matches  → CC owns it: update / uninstall it
//   sidecar present, hash differs  → the user edited it: leave it alone
//   no (readable) sidecar          → user-owned: leave it alone
//
// Node built-ins only and electron-free: main.js uses it at startup, and the
// NSIS uninstaller runs it under plain `node` through uninstall-hooks.js
// (which is why it lives in hooks/, unpacked from the asar). Files are copied
// with read + write, not copyFile, so reading from inside the asar works.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SIDECAR = '.command-center.json';
const SKILL_FILE = 'SKILL.md';

function hashText(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readSidecar(dir) {
  const raw = readText(path.join(dir, SIDECAR));
  if (raw === null) return null;
  try {
    const j = JSON.parse(raw);
    return j && typeof j.hash === 'string' ? j : null;
  } catch {
    return null;
  }
}

function listDirs(root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// → { install: [], update: [], current: [], skip: [] }; each entry
// { name, dest, text } (skip: { name, dest, reason }).
function planSync(bundledDir, targetDir) {
  const plan = { install: [], update: [], current: [], skip: [] };
  for (const name of listDirs(bundledDir)) {
    const src = readText(path.join(bundledDir, name, SKILL_FILE));
    if (src === null) continue;
    const text = src.replace(/\r\n/g, '\n');
    const dest = path.join(targetDir, name);
    const installed = readText(path.join(dest, SKILL_FILE));
    if (installed === null) {
      plan.install.push({ name, dest, text });
      continue;
    }
    const side = readSidecar(dest);
    if (!side) {
      plan.skip.push({ name, dest, reason: 'not installed by Command Center (unmarked)' });
    } else if (side.hash !== hashText(installed)) {
      plan.skip.push({ name, dest, reason: 'edited since Command Center installed it' });
    } else if (side.hash === hashText(text)) {
      plan.current.push({ name, dest, text });
    } else {
      plan.update.push({ name, dest, text });
    }
  }
  return plan;
}

// Writes every install/update entry. → { written: [names], errors: [{ name, error }] }
function applySync(plan) {
  const written = [];
  const errors = [];
  for (const entry of [...plan.install, ...plan.update]) {
    try {
      fs.mkdirSync(entry.dest, { recursive: true });
      fs.writeFileSync(path.join(entry.dest, SKILL_FILE), entry.text, 'utf8');
      const sidecar = { hash: hashText(entry.text), installedBy: 'Command Center', installedAt: new Date().toISOString() };
      fs.writeFileSync(path.join(entry.dest, SIDECAR), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
      written.push(entry.name);
    } catch (err) {
      errors.push({ name: entry.name, error: (err && err.message) || String(err) });
    }
  }
  return { written, errors };
}

// Uninstall: deletes SKILL.md and the sidecar of every skill CC owns (hash
// matches), then the folder if nothing else is left in it. → [names]
function removeOwned(targetDir) {
  const removed = [];
  for (const name of listDirs(targetDir)) {
    const dir = path.join(targetDir, name);
    const side = readSidecar(dir);
    if (!side) continue;
    const installed = readText(path.join(dir, SKILL_FILE));
    if (installed === null || side.hash !== hashText(installed)) continue;
    try {
      fs.rmSync(path.join(dir, SKILL_FILE), { force: true });
      fs.rmSync(path.join(dir, SIDECAR), { force: true });
      removed.push(name);
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* best effort: uninstall must not fail on one locked file */
    }
  }
  return removed;
}

module.exports = { planSync, applySync, removeOwned, hashText, SIDECAR };
