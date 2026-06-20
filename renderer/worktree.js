'use strict';

import { els } from './dom.js';
import { spawn } from './agents.js';
import { confirmDialog } from './modals.js';

// ---------------------------------------------------------------------------
// New worktree dialog. Two views inside one modal:
//   pick  — search/open an existing worktree or branch. The search box doubles
//           as the new-branch name; when it names a branch that doesn't exist,
//           the "Create branch" button enables.
//   base  — pick the base ref for the new branch, reusing the same list UI.
// ---------------------------------------------------------------------------

export async function newAgent(p) {
  await openWorktreePicker(p);
}

async function openWorktreePicker(p) {
  const [worktrees, branches] = await Promise.all([
    window.api.listWorktrees(p.dir),
    window.api.listBranches(p.dir),
  ]);
  const { current, local, remote } = branches;
  const localNames = new Set(local.map((b) => b.name));

  // All refs offered as a base for a new branch (current first, then the rest).
  const baseRefs = [];
  if (current) baseRefs.push({ value: current, label: `${current} (current)`, icon: '⎇' });
  for (const b of local) if (b.name !== current) baseRefs.push({ value: b.name, label: b.name, icon: '⎇' });
  for (const r of remote) baseRefs.push({ value: r.name, label: r.name, icon: '⬇' });

  let pendingName = '';

  const close = () => {
    els.wtPicker.hidden = true;
  };

  const showView = (view) => {
    els.wtViewPick.hidden = view !== 'pick';
    els.wtViewBase.hidden = view !== 'base';
    els.wtTitle.textContent = view === 'pick' ? 'Open worktree' : 'New branch';
  };

  // ---- View 1: pick existing ----
  const renderPick = (query = '') => {
    const q = query.trim().toLowerCase();
    const match = (s) => (s || '').toLowerCase().includes(q);
    const list = els.wtResults;
    list.innerHTML = '';

    const wts = worktrees.filter((w) => match(w.branch) || match(w.path));
    const free = local.filter((b) => !b.hasWorktree && match(b.name));
    const newRemotes = remote.filter((r) => !r.hasLocal && match(r.name));

    if (wts.length) {
      list.appendChild(groupHeader('Worktrees'));
      for (const w of wts) list.appendChild(worktreeRow(p, w, close));
    }
    if (free.length) {
      list.appendChild(groupHeader('Local branches'));
      for (const b of free) list.appendChild(localRow(p, b));
    }
    if (newRemotes.length) {
      list.appendChild(groupHeader('Remote branches'));
      for (const r of newRemotes) list.appendChild(remoteRow(p, r));
    }
    if (!list.children.length) list.appendChild(emptyRow('No matching branches.'));
  };

  // The Create button reflects the search box: only a non-existing name enables
  // it. Empty / existing-branch input keeps it disabled.
  const newName = () => els.wtSearch.value.trim();
  const canCreate = () => {
    const name = newName();
    return !!name && !localNames.has(name);
  };
  const updateNewBtn = () => {
    const name = newName();
    els.wtNewBtn.disabled = !canCreate();
    els.wtNewBtn.textContent = canCreate() ? `＋ Create branch “${name}”` : '＋ Create new branch';
  };

  // Step 2: pick the base ref for the new branch.
  const goBase = () => {
    if (!canCreate()) return;
    pendingName = newName();
    els.wtBaseName.textContent = `“${pendingName}”`;
    els.wtBaseSearch.value = '';
    renderBase('');
    showView('base');
    els.wtBaseSearch.focus();
  };

  // ---- View 2: base ----
  const renderBase = (query = '') => {
    const q = query.trim().toLowerCase();
    const list = els.wtBaseResults;
    list.innerHTML = '';
    const refs = baseRefs.filter((r) => r.label.toLowerCase().includes(q));
    if (!refs.length) {
      list.appendChild(emptyRow('No matching base branch.'));
      return;
    }
    for (const ref of refs) {
      const li = document.createElement('li');
      li.className = 'wt-row';
      li.innerHTML = `<span class="wt-branch">${ref.icon} ${ref.label}</span>`;
      li.addEventListener('click', () =>
        createWorktreeFlow(p, { mode: 'new', branch: pendingName, base: ref.value })
      );
      list.appendChild(li);
    }
  };

  // ---- wiring ----
  els.wtSearch.value = '';
  els.wtSearch.oninput = () => {
    renderPick(els.wtSearch.value);
    updateNewBtn();
  };
  els.wtSearch.onkeydown = (e) => {
    if (e.key === 'Enter') goBase();
    else if (e.key === 'Escape') close();
  };
  els.wtNewBtn.onclick = goBase;

  els.wtBaseSearch.oninput = () => renderBase(els.wtBaseSearch.value);
  els.wtBaseSearch.onkeydown = (e) => {
    if (e.key === 'Escape') showView('pick');
  };
  els.wtBaseBack.onclick = () => showView('pick');

  renderPick();
  updateNewBtn();
  showView('pick');
  els.wtPicker.hidden = false;
  els.wtSearch.focus();
}

// ---- row builders ----

function groupHeader(text) {
  const li = document.createElement('li');
  li.className = 'wt-group';
  li.textContent = text;
  return li;
}

function worktreeRow(p, w, close) {
  const li = document.createElement('li');
  li.className = 'wt-row';

  const head = document.createElement('div');
  head.className = 'wt-head';
  const branchEl = document.createElement('span');
  branchEl.className = 'wt-branch';
  branchEl.textContent = w.branch ? `⎇ ${w.branch}` : '(detached)';
  head.appendChild(branchEl);
  for (const b of worktreeBadges(w)) head.appendChild(b);
  li.appendChild(head);

  const pathEl = document.createElement('span');
  pathEl.className = 'wt-path';
  pathEl.textContent = w.path;
  li.appendChild(pathEl);

  li.addEventListener('click', () => {
    close();
    spawn(p.dir, w.path, w.branch, w.isMain);
  });
  return li;
}

function localRow(p, b) {
  const li = document.createElement('li');
  li.className = 'wt-row';
  li.innerHTML = `<span class="wt-branch">⎇ ${b.name}</span>`;
  li.addEventListener('click', () => createWorktreeFlow(p, { mode: 'local', branch: b.name }));
  return li;
}

function remoteRow(p, r) {
  const li = document.createElement('li');
  li.className = 'wt-row';
  li.innerHTML = `<span class="wt-branch">⬇ ${r.name}</span>`;
  li.title = 'Creates a local tracking branch';
  li.addEventListener('click', () => createWorktreeFlow(p, { mode: 'remote', branch: r.name }));
  return li;
}

function worktreeBadges(w) {
  const out = [];
  const add = (cls, text, title) => {
    const s = document.createElement('span');
    s.className = `wt-badge ${cls}`;
    s.textContent = text;
    s.title = title;
    out.push(s);
  };
  if (w.dirty) add('dirty', `±${w.dirty}`, `${w.dirty} uncommitted file(s)`);
  if (w.ahead) add('ahead', `↑${w.ahead}`, `${w.ahead} commit(s) ahead of upstream`);
  if (w.behind) add('behind', `↓${w.behind}`, `${w.behind} commit(s) behind upstream`);
  return out;
}

function emptyRow(text) {
  const li = document.createElement('li');
  li.className = 'wt-empty';
  li.textContent = text;
  return li;
}

async function createWorktreeFlow(p, opts) {
  const res = await window.api.createWorktree({ dir: p.dir, ...opts });
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
