'use strict';

import { els } from './dom.js';
import { state, agents } from './state.js';
import { confirmDialog, openMenu } from './modals.js';

// ---------------------------------------------------------------------------
// Stage toolbar — shows the active agent's branch and per-agent actions
// (git fetch / pull, find-in-terminal). Refreshed on every activate().
// ---------------------------------------------------------------------------

// The fetch/pull buttons are shared DOM shown for whichever agent is active.
// Track in-flight ops per action (not per agent) so overlapping runGit calls
// — e.g. fetch on A, switch to B, fetch on B — can't reset each other's
// shared button state, and updateStageBar won't re-enable a running button.
const gitInFlight = new Set();

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
  els.sbFetch.disabled = noGit || gitInFlight.has('fetch');
  els.sbPull.disabled = noGit || gitInFlight.has('pull');
  els.sbDiff.disabled = noGit;
}

async function runGit(action, label) {
  const a = state.activeId && agents.get(state.activeId);
  if (!a) return;
  // Bail if this op is already running — the button is shared, so a second
  // concurrent run would corrupt the first's in-progress label/disabled state.
  if (gitInFlight.has(action)) return;
  const btn = action === 'fetch' ? els.sbFetch : els.sbPull;
  const lbl = btn.querySelector('.sb-label');
  gitInFlight.add(action);
  btn.disabled = true;
  lbl.textContent = `${label}…`;
  let res;
  try {
    res = action === 'fetch'
      ? await window.api.gitFetch(a.cwd)
      : await window.api.gitPull(a.cwd);
  } finally {
    // Always clear in-flight state, even if the IPC call rejects — otherwise the
    // shared button stays permanently disabled and stuck on "Fetch…".
    gitInFlight.delete(action);
    lbl.textContent = label;
    btn.disabled = false;
  }
  if (!res.ok) {
    await confirmDialog(`${label} failed`, res.error || 'git reported an error.', { alert: true });
  } else if (res.out) {
    await confirmDialog(label, res.out, { alert: true });
  }
}

// Open the active agent's worktree in an external tool; surface failures.
async function openActive(invoke, label) {
  const a = state.activeId && agents.get(state.activeId);
  if (!a) return;
  const res = await invoke(a.cwd);
  if (res && res.error) await confirmDialog(`${label} failed`, res.error, { alert: true });
}

// ---------------------------------------------------------------------------
// Open-in split button — main click opens the worktree in the picked target;
// the caret switches the target (Visual Studio / VS Code / Explorer) and
// remembers the choice. Picking a target only swaps the button; it does not
// open — opening always goes through the main button.
// ---------------------------------------------------------------------------

const EDITORS = {
  vs: {
    label: 'Visual Studio',
    invoke: (cwd) => window.api.openInVS(cwd),
    icon: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="#9B4F96" d="M17.6 1.9 11 8.5 6.6 5 4 6.2v11.6L6.6 19 11 15.5l6.6 6.6L21 20.4V3.6L17.6 1.9ZM6.6 14.6V9.4L9.2 12l-2.6 2.6Zm9.4.9L12.4 12 16 8.5v7Z"/></svg>',
  },
  code: {
    label: 'Visual Studio Code',
    invoke: (cwd) => window.api.openInVSCode(cwd),
    icon: '<svg viewBox="-2.5 -2.5 29 29" width="14" height="14" aria-hidden="true"><path fill="#0098FF" d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1.001 1.001 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 15.6L10.826 12l7.178-6.187z"/></svg>',
  },
  explorer: {
    label: 'Explorer',
    invoke: (cwd) => window.api.openInExplorer(cwd),
    icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  },
};

const EDITOR_KEY = 'editorChoice';
let editorChoice = EDITORS[localStorage.getItem(EDITOR_KEY)] ? localStorage.getItem(EDITOR_KEY) : 'vs';

function renderEditorBtn() {
  const e = EDITORS[editorChoice];
  els.sbVs.innerHTML = `${e.icon}<span class="sb-label">${e.label}</span>`;
  els.sbVs.title = `Open worktree in ${e.label}`;
}

function setEditor(key) {
  editorChoice = key;
  localStorage.setItem(EDITOR_KEY, key);
  renderEditorBtn();
}

renderEditorBtn();

els.sbVs.addEventListener('click', () => {
  const e = EDITORS[editorChoice];
  openActive(e.invoke, `Open in ${e.label}`);
});

els.sbEditorCaret.addEventListener('click', (ev) => {
  ev.stopPropagation();
  openMenu(
    els.sbVs.parentElement,
    Object.entries(EDITORS)
      .filter(([key]) => key !== editorChoice)
      .map(([key, e]) => ({
        label: e.label,
        icon: e.icon,
        action: () => setEditor(key),
      })),
    { className: 'menu-editor', matchWidth: true }
  );
});
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
