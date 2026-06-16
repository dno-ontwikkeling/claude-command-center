'use strict';

/* global Terminal, FitAddon */

import { els } from './dom.js';
import { agents, agentSeq, pendingExit, dormant, state, persistAgents } from './state.js';
import { settings, termOpts } from './settings.js';
import { confirmDialog, promptText } from './modals.js';
import { renderSidebar } from './sidebar.js';

// ---------------------------------------------------------------------------
// Agents / terminals
// ---------------------------------------------------------------------------

// `restore` resumes a dormant agent: it reuses the old id/label and passes the
// stored session id so Claude reopens the same conversation (`claude --resume`).
export function spawn(dir, cwd, branch, isMain, restore = null) {
  let id, label;
  if (restore) {
    id = restore.id;
    label = restore.label;
  } else {
    id = `a${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const seq = (agentSeq.get(dir) || 0) + 1;
    agentSeq.set(dir, seq);
    label = `Agent ${seq}`;
  }

  const el = document.createElement('div');
  el.className = 'term';
  els.terminals.appendChild(el);

  const term = new Terminal(termOpts());
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);

  term.onData((data) => window.api.sendInput(id, data));

  // Refit whenever the panel changes size. Skipped while hidden (0 size),
  // so the pty is sized to the real visible panel, not the initial 80x30.
  const refit = () => {
    if (el.clientHeight === 0 || el.clientWidth === 0) return;
    try {
      fit.fit();
      window.api.resize(id, term.cols, term.rows);
    } catch {
      /* terminal disposed */
    }
  };
  const ro = new ResizeObserver(() => requestAnimationFrame(refit));
  ro.observe(el);
  document.fonts.ready.then(refit);

  agents.set(id, {
    dir,
    cwd,
    branch,
    isMain,
    label,
    customLabel: restore?.customLabel || null,
    sessionId: restore?.sessionId || null,
    used: !!restore, // a restored agent was already used (that's why it persisted)
    term,
    fit,
    el,
    ro,
    refit,
    status: 'busy',
    dotEl: null,
  });

  window.api.spawn(id, cwd, { bypass: settings.bypass, resume: restore?.sessionId || null });
  persistAgents();
  renderSidebar();
  activate(id);
}

// Resume a dormant agent into a live one, reopening its Claude session.
export function resume(id) {
  const d = dormant.get(id);
  if (!d) return;
  dormant.delete(id);
  spawn(d.dir, d.cwd, d.branch, d.isMain, {
    id: d.id,
    sessionId: d.sessionId,
    label: d.label,
    customLabel: d.customLabel,
  });
}

// Forget a dormant agent for good (its session stays on disk but we stop
// tracking it). Used from the dormant row's kebab menu.
export function removeDormant(id) {
  dormant.delete(id);
  persistAgents();
  if (agents.size === 0 && dormant.size === 0) els.empty.style.display = '';
  renderSidebar();
}

export async function renameAgent(id) {
  const a = agents.get(id);
  if (!a) return;
  const current = a.customLabel || (a.branch ? `⎇ ${a.branch}` : a.label);
  const name = await promptText('Rename agent', current);
  if (!name) return;
  a.customLabel = name;
  persistAgents();
  renderSidebar();
}

export async function deleteWorktree(id) {
  const a = agents.get(id);
  if (!a) return;
  const { dir, cwd } = a;
  const ok = await confirmDialog('Remove worktree', `This deletes the worktree from disk:\n\n${cwd}`, {
    okLabel: 'Remove',
    danger: true,
  });
  if (!ok) return;

  // Kill the agent first and wait for the process to exit, otherwise its cwd
  // keeps a file lock on the folder and git/Windows can't remove it.
  await killAndWait(id);

  let res = await window.api.removeWorktree(dir, cwd, false);
  if (res.error) {
    const force = await confirmDialog('Force remove worktree', `git refused:\n\n${res.error}\n\nForce remove? This discards uncommitted changes.`, {
      okLabel: 'Force remove',
      danger: true,
    });
    if (force) res = await window.api.removeWorktree(dir, cwd, true);
  }
  if (res.error) await confirmDialog('Removal failed', res.error, { alert: true });

  // The agent is already dead; drop its row regardless of removal outcome.
  cleanupAgent(id);
}

// Kill the agent's pty and resolve once it has actually exited (with a short
// grace period for the OS to release the cwd handle). Falls back on timeout.
function killAndWait(id) {
  return new Promise((resolve) => {
    const a = agents.get(id);
    if (!a) {
      resolve();
      return;
    }
    a.intentional = true; // exit is deliberate — do not keep a dormant record
    pendingExit.set(id, resolve);
    window.api.kill(id);
    setTimeout(() => {
      if (pendingExit.delete(id)) resolve();
    }, 2500);
  });
}

// Dispose the terminal + remove the row, without killing (caller handles kill).
function cleanupAgent(id, skipRender = false) {
  const a = agents.get(id);
  if (!a) return;
  try {
    a.ro.disconnect();
    a.term.dispose();
  } catch {
    /* already gone */
  }
  a.el.remove();
  agents.delete(id);
  dormant.delete(id); // never leave a resumable record for a removed agent
  persistAgents();
  if (state.activeId === id) state.activeId = null;
  // Reset the label counter once a project has no agents left, so a relaunch
  // starts back at "Agent 1" instead of climbing forever.
  if (agentsForDirCount(a.dir) === 0) agentSeq.delete(a.dir);
  if (agents.size === 0 && dormant.size === 0) els.empty.style.display = '';
  if (!skipRender) renderSidebar();
}

// pty exited on its own (Claude quit / app closed). If the agent carries a
// session id and the exit was not deliberate, keep it as a resumable dormant
// record instead of discarding it.
function convertToDormant(id) {
  const a = agents.get(id);
  if (!a) return;
  try {
    a.ro.disconnect();
    a.term.dispose();
  } catch {
    /* already gone */
  }
  a.el.remove();
  agents.delete(id);
  dormant.set(id, {
    id,
    dir: a.dir,
    cwd: a.cwd,
    branch: a.branch,
    isMain: a.isMain,
    customLabel: a.customLabel || null,
    sessionId: a.sessionId,
    label: a.label,
    lastActive: a.lastActive || Date.now(),
  });
  if (state.activeId === id) state.activeId = null;
  persistAgents();
  renderSidebar();
}

function agentsForDirCount(dir) {
  let n = 0;
  for (const a of agents.values()) if (a.dir === dir) n++;
  return n;
}

export function removeAgent(id, skipRender = false) {
  window.api.kill(id);
  cleanupAgent(id, skipRender);
}

export function activate(id) {
  state.activeId = id;
  els.empty.style.display = 'none';
  for (const [aid, a] of agents) {
    a.el.classList.toggle('active', aid === id);
  }
  for (const row of els.list.querySelectorAll('.agent')) {
    row.classList.toggle('active', row.dataset.id === id);
  }
  const a = agents.get(id);
  if (a) {
    a.lastActive = Date.now();
    requestAnimationFrame(() => {
      a.refit();
      a.term.focus();
    });
  }
}

function setStatus(id, status) {
  const a = agents.get(id);
  if (!a) return;
  a.status = status;
  if (a.dotEl) a.dotEl.className = `dot ${status}`;
}

const IDLE_AFTER_MS = 1200;

// Terminal output flowing = busy; quiet for IDLE_AFTER_MS = idle. This covers
// the gap hooks can't see (e.g. a freshly started agent sitting at its prompt).
function markActivity(id) {
  const a = agents.get(id);
  if (!a || a.status === 'dead') return;
  a.awaitingInput = false;
  setStatus(id, 'busy');
  clearTimeout(a.idleTimer);
  a.idleTimer = setTimeout(() => {
    const x = agents.get(id);
    if (x && x.status !== 'dead' && !x.awaitingInput) setStatus(id, 'idle');
  }, IDLE_AFTER_MS);
}

// ---------------------------------------------------------------------------
// Main-process streams
// ---------------------------------------------------------------------------

window.api.onData(({ id, data }) => {
  const a = agents.get(id);
  if (!a) return;
  a.term.write(data);
  markActivity(id);
});

window.api.onExit(({ id }) => {
  const a = agents.get(id);
  if (!a) return; // already cleaned up by a deliberate removal
  clearTimeout(a.idleTimer);

  // Release any kill waiter first (worktree removal needs the file lock gone).
  const resolve = pendingExit.get(id);
  if (resolve) {
    pendingExit.delete(id);
    setTimeout(resolve, 250); // grace for OS to release the cwd handle
  }

  // Natural exit with a *used* session -> keep it resumable; otherwise dead.
  // (An untouched session has no transcript on disk, so resume would fail.)
  if (a.sessionId && a.used && !a.intentional) convertToDormant(id);
  else setStatus(id, 'dead');
});

// Hooks own the states activity can't infer: needs-input (blocked) and dead.
// busy/idle are driven by terminal activity above. The session id also arrives
// here (from the hook payload) — capture it, and mark the agent "used" once a
// prompt has been submitted (only then does Claude persist the transcript).
window.api.onEvent(({ agentId, status, sessionId, event }) => {
  const a = agents.get(agentId);
  if (!a) return;
  if (sessionId && a.sessionId !== sessionId) a.sessionId = sessionId;
  if (event === 'UserPromptSubmit' && !a.used) a.used = true;
  if (sessionId || event === 'UserPromptSubmit') persistAgents();
  if (status === 'needs-input') {
    a.awaitingInput = true;
    clearTimeout(a.idleTimer);
    setStatus(agentId, 'needs-input');
  } else if (status === 'dead') {
    clearTimeout(a.idleTimer);
    setStatus(agentId, 'dead');
  }
});
