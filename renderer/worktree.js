'use strict';

import { els } from './dom.js';
import { spawn } from './agents.js';
import { confirmDialog } from './modals.js';

// ---------------------------------------------------------------------------
// New agent — for git projects, choose a worktree first
// ---------------------------------------------------------------------------

export async function newAgent(p) {
  if (!p.isGit) {
    spawn(p.dir, p.dir, null, false);
    return;
  }
  await openWorktreePicker(p);
}

async function openWorktreePicker(p) {
  const [worktrees, branches] = await Promise.all([
    window.api.listWorktrees(p.dir),
    window.api.listBranches(p.dir),
  ]);

  // --- existing worktrees ---
  els.wtList.innerHTML = '';
  for (const w of worktrees) {
    const row = document.createElement('li');
    row.className = 'wt-row';
    row.innerHTML = `<span class="wt-branch">${w.branch ? `⎇ ${w.branch}` : '(detached)'}</span>`;
    const pathEl = document.createElement('span');
    pathEl.className = 'wt-path';
    pathEl.textContent = w.path;
    row.appendChild(pathEl);
    row.addEventListener('click', () => {
      els.wtPicker.hidden = true;
      spawn(p.dir, w.path, w.branch, w.isMain);
    });
    els.wtList.appendChild(row);
  }

  // --- existing branches without a worktree ---
  els.wtBranches.innerHTML = '';
  const free = branches.filter((b) => !b.hasWorktree);
  if (!free.length) {
    const li = document.createElement('li');
    li.className = 'wt-empty';
    li.textContent = 'No spare branches — every branch already has a worktree.';
    els.wtBranches.appendChild(li);
  }
  for (const b of free) {
    const row = document.createElement('li');
    row.className = 'wt-row';
    row.innerHTML = `<span class="wt-branch">⎇ ${b.name}</span>`;
    row.addEventListener('click', () => createWorktreeFlow(p, b.name, false));
    els.wtBranches.appendChild(row);
  }

  // --- new branch (validated against existing names) ---
  const existing = new Set(branches.map((b) => b.name));
  els.wtNewName.value = '';
  els.wtNewErr.textContent = '';
  els.wtNewName.oninput = () => {
    const v = els.wtNewName.value.trim();
    els.wtNewErr.textContent = existing.has(v) ? 'Branch already exists — pick it below instead.' : '';
  };
  els.wtCreate.onclick = () => {
    const name = els.wtNewName.value.trim();
    if (!name) return;
    if (existing.has(name)) {
      els.wtNewErr.textContent = 'Branch already exists — pick it below instead.';
      return;
    }
    createWorktreeFlow(p, name, true);
  };

  els.wtPicker.hidden = false;
}

async function createWorktreeFlow(p, branch, newBranch) {
  const res = await window.api.createWorktree(p.dir, branch, newBranch);
  if (res.canceled) return;
  if (res.error) {
    await confirmDialog('Worktree creation failed', res.error, { alert: true });
    return;
  }
  els.wtPicker.hidden = true;
  spawn(p.dir, res.path, res.branch, false);
}

els.wtClose.addEventListener('click', () => (els.wtPicker.hidden = true));
els.wtPicker.addEventListener('click', (e) => {
  if (e.target === els.wtPicker) els.wtPicker.hidden = true;
});
