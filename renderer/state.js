'use strict';

// Shared mutable state. Maps are exported directly (mutated in place). Values
// that get reassigned live on the `state` object so importers see live updates
// (an exported `let` binding is read-only for importers).

/** agentId -> { dir, cwd, branch, isMain, label, customLabel, term, fit, el, ro, refit, status, dotEl, idleTimer, awaitingInput } */
export const agents = new Map();

/** dir -> running agent counter (for labels) */
export const agentSeq = new Map();

/** agentId -> resolver, awaiting the pty's exit (to release file locks) */
export const pendingExit = new Map();

/**
 * Dormant agents: a pty cannot survive a restart, but a Claude *session* can.
 * When an agent's pty exits while it still has a session id, we keep a dormant
 * record so the conversation can be resumed (`claude --resume <sessionId>`).
 * agentId -> { id, dir, cwd, branch, isMain, customLabel, sessionId, label, lastActive }
 */
export const dormant = new Map();

export const state = {
  /** cached project list [{ dir, name, isGit }] */
  projectsData: [],
  /** cached workspace list [{ dir, name, isGit, type }] — scratch folders */
  workspacesData: [],
  activeId: null,
};

export function agentsForDir(dir) {
  return [...agents.entries()]
    .filter(([, a]) => a.dir === dir)
    .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));
}

export function dormantForDir(dir) {
  return [...dormant.entries()].filter(([, d]) => d.dir === dir);
}

// ---------------------------------------------------------------------------
// Lifecycle pub/sub. agents.js emits a change after every state-mutating action
// instead of importing the sidebar directly (which formed an agents<->sidebar
// import cycle). A coordinator (app.js) subscribes and re-renders. Both agents.js
// and sidebar.js already import this module, so the emitter lives here.
// ---------------------------------------------------------------------------

const changeSubs = new Set();

/** Register a listener fired after any agent/dormant lifecycle change. Returns
 *  an unsubscribe function. */
export function onAgentsChanged(cb) {
  changeSubs.add(cb);
  return () => changeSubs.delete(cb);
}

/** Emit a lifecycle change so subscribers (the sidebar) re-render. */
export function notifyAgentsChanged() {
  for (const cb of changeSubs) cb();
}

// ---------------------------------------------------------------------------
// Persistence — only session-bearing agents survive a restart, as dormant rows
// ---------------------------------------------------------------------------

const STORE_KEY = 'savedAgents';

function record(id, a) {
  return {
    id,
    dir: a.dir,
    cwd: a.cwd,
    branch: a.branch,
    isMain: a.isMain,
    customLabel: a.customLabel || null,
    sessionId: a.sessionId,
    label: a.label,
    order: a.order ?? 0,
    lastActive: a.lastActive || Date.now(),
  };
}

export function persistAgents() {
  const out = [];
  // Only persist agents whose session has had a real prompt — an untouched
  // session is never written to disk, so `claude --resume` would fail on it.
  for (const [id, a] of agents) {
    if (a.sessionId && a.used) out.push(record(id, a));
  }
  for (const d of dormant.values()) out.push(d);
  localStorage.setItem(STORE_KEY, JSON.stringify(out));
}

export function loadDormant() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch {
    saved = [];
  }
  for (const r of saved) {
    if (r && r.id && r.sessionId) dormant.set(r.id, r);
  }
}
