'use strict';

import { els } from './dom.js';
import { state, agents } from './state.js';
import { confirmDialog } from './modals.js';

// ---------------------------------------------------------------------------
// Stage toolbar — shows the active agent's branch and per-agent actions
// (git fetch / pull, find-in-terminal). Refreshed on every activate().
// ---------------------------------------------------------------------------

export function updateStageBar() {
  const a = state.activeId && agents.get(state.activeId);
  if (!a) {
    els.stageBar.hidden = true;
    closeSearch();
    return;
  }
  els.stageBar.hidden = false;
  els.sbBranch.textContent = a.branch ? `⎇ ${a.branch}` : '(no branch)';
  // git actions only make sense on a real branch (worktree / repo checkout).
  const noGit = !a.branch;
  els.sbFetch.disabled = noGit;
  els.sbPull.disabled = noGit;
}

async function runGit(action, label) {
  const a = state.activeId && agents.get(state.activeId);
  if (!a) return;
  const btn = action === 'fetch' ? els.sbFetch : els.sbPull;
  btn.disabled = true;
  btn.textContent = `${label}…`;
  const res = action === 'fetch'
    ? await window.api.gitFetch(a.cwd)
    : await window.api.gitPull(a.cwd);
  btn.textContent = label;
  btn.disabled = false;
  if (!res.ok) {
    await confirmDialog(`${label} failed`, res.error || 'git reported an error.', { alert: true });
  } else if (res.out) {
    await confirmDialog(label, res.out, { alert: true });
  }
}

els.sbFetch.addEventListener('click', () => runGit('fetch', 'Fetch'));
els.sbPull.addEventListener('click', () => runGit('pull', 'Pull'));
els.sbFind.addEventListener('click', () => openSearch());

// ---------------------------------------------------------------------------
// Find-in-terminal — drives the active agent's SearchAddon.
// ---------------------------------------------------------------------------

function searchOpts() {
  return {
    caseSensitive: els.searchCase.checked,
    regex: els.searchRegex.checked,
  };
}

function activeSearch() {
  const a = state.activeId && agents.get(state.activeId);
  return a ? a.search : null;
}

function find(forward = true) {
  const s = activeSearch();
  const q = els.searchInput.value;
  if (!s || !q) return;
  if (forward) s.findNext(q, searchOpts());
  else s.findPrevious(q, searchOpts());
}

export function openSearch() {
  if (!activeSearch()) return;
  els.termSearch.hidden = false;
  els.searchInput.focus();
  els.searchInput.select();
}

export function closeSearch() {
  els.termSearch.hidden = true;
  const s = activeSearch();
  try {
    s?.clearDecorations?.();
  } catch {
    /* addon has no decorations configured */
  }
  const a = state.activeId && agents.get(state.activeId);
  a?.term.focus();
}

els.searchInput.addEventListener('input', () => find(true));
els.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    find(!e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  }
});
els.searchNext.addEventListener('click', () => find(true));
els.searchPrev.addEventListener('click', () => find(false));
els.searchClose.addEventListener('click', () => closeSearch());
els.searchCase.addEventListener('change', () => find(true));
els.searchRegex.addEventListener('change', () => find(true));
