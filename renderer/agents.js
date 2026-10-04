'use strict';

/* global Terminal, FitAddon, SearchAddon, WebLinksAddon */

import { els } from './dom.js';
import { agents, agentSeq, pendingExit, dormant, state, persistAgents, agentsForDir, dormantForDir, notifyAgentsChanged, record, displayLabel, onAgentsChanged, onStatusChanged } from './state.js';
import { buildRemoteSnapshot, createSnapshotPusher } from './remote-sync.mjs';
import { settings, termOpts } from './settings.js';
import { confirmDialog, promptText, closeMenu } from './modals.js';
import { updateStageBar, openSearch } from './stage.js';
import { setStatus, forceStatus, markActivity, detectPrompts, handleAgentEvent } from './agent-status.mjs';

export { forceStatus };

// ---------------------------------------------------------------------------
// Agents / terminals
// ---------------------------------------------------------------------------

// Right-click terminal menu. Claude's TUI turns on mouse tracking, which
// swallows plain drag-select and the browser's native menu, so we give an
// explicit Copy/Paste path here. Reuses the kebab `.menu` styling.
function closeTermMenu() {
  document.getElementById('term-menu')?.remove();
}

function openTermMenu(x, y, term, selection) {
  closeMenu(); // dismiss any open kebab menu
  closeTermMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.id = 'term-menu';
  const items = [
    // `selection` is snapshotted by the caller before the right-click / a TUI
    // repaint can clear it — reading term.getSelection() here would be too late.
    { label: 'Copy', disabled: !selection, action: () => window.api.writeClipboard(selection) },
    {
      label: 'Paste',
      action: () => {
        const t = window.api.readClipboard();
        if (t) term.paste(t);
      },
    },
  ];
  for (const it of items) {
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.disabled) b.disabled = true;
    else b.addEventListener('click', () => { closeTermMenu(); it.action(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.min(x, window.innerWidth - menu.offsetWidth - 8)}px`;
}

// Any click outside the menu dismisses it (fires before contextmenu reopen).
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#term-menu')) closeTermMenu();
});

// `restore` resumes a dormant agent: it reuses the old id/label and passes the
// stored session id so Claude reopens the same conversation (`claude --resume`).
// `opts` comes from a phone-initiated spawn: `background` adds the agent
// without switching the desktop's visible terminal; `cols`/`rows` size the pty
// for the phone from the start. Returns the agent id.
export function spawn(dir, cwd, branch, isMain, restore = null, opts = {}) {
  let id, label;
  if (restore) {
    id = restore.id;
    label = restore.label;
  } else {
    id = `a${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const seq = (agentSeq.get(dir) || 0) + 1;
    agentSeq.set(dir, seq);
    label = `Session ${seq}`;
  }

  const el = document.createElement('div');
  el.className = 'term';
  els.terminals.appendChild(el);

  // Shown instead of the terminal while the phone has control of this agent.
  const remoteOverlay = document.createElement('div');
  remoteOverlay.className = 'remote-overlay';
  remoteOverlay.hidden = true;
  remoteOverlay.innerHTML =
    '<div class="remote-box"><div class="remote-title">Working remotely</div>' +
    '<p>This agent is being used from your phone.</p>' +
    '<button class="btn-primary">Take over</button></div>';
  remoteOverlay.querySelector('button').addEventListener('click', () => takeOver(id));

  const term = new Terminal(termOpts());
  const fit = new FitAddon.FitAddon();
  const search = new SearchAddon.SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  // Clickable links -> open in the OS default browser (main validates the URL).
  term.loadAddon(
    new WebLinksAddon.WebLinksAddon((_e, uri) => window.api.openExternal(uri))
  );
  term.open(el);
  el.appendChild(remoteOverlay);

  // Claude's TUI repaints constantly (spinner/status line), and every repaint
  // wipes the xterm selection. Waiting for mouseup / Ctrl+C / a right-click to
  // read the selection therefore loses it. Instead, react the moment the
  // selection changes — even mid-drag — so the text survives the next repaint:
  // cache it for the copy paths, and (Linux-terminal style) push it straight to
  // the clipboard when select-to-copy is on. Hold Shift to force a local
  // selection while Claude is grabbing the mouse (xterm built-in).
  let lastSelection = '';
  term.onSelectionChange(() => {
    const sel = term.getSelection();
    if (!sel) return;
    lastSelection = sel;
    if (settings.copyOnSelect) window.api.writeClipboard(sel);
  });

  // Right-click -> Copy/Paste menu at the cursor. Prefer the live selection,
  // but fall back to the cached one (a repaint may have already cleared it).
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openTermMenu(e.clientX, e.clientY, term, term.getSelection() || lastSelection);
  });

  // Custom key handling. xterm has no Edit-role menu wired (no Electron menu),
  // and treats Ctrl+Enter the same as Enter, so we intercept both here.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;

    // Ctrl+Enter -> insert newline instead of submitting. Claude reads the
    // meta+enter sequence (ESC + CR) as "newline", while a bare CR submits.
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'Enter') {
      window.api.sendInput(id, '\x1b\r');
      return false;
    }

    // Ctrl+F -> open find-in-terminal instead of sending the byte to the pty.
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      openSearch();
      return false;
    }

    // Ctrl+V -> paste exactly once. We must preventDefault so Chromium's own
    // native `paste` event does NOT also fire into xterm's textarea: returning
    // false from this handler stops xterm, but does NOT cancel the DOM default,
    // so without preventDefault the clipboard text lands twice (term.paste +
    // native). Clipboard read hops through main (sandboxed preload).
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      const text = window.api.readClipboard();
      if (text) term.paste(text);
      return false;
    }

    // Ctrl+C -> copy when text is selected; otherwise let it through as SIGINT.
    // A repaint may have cleared the live selection, so fall back to the cached
    // one, then consume it so the next Ctrl+C still interrupts (SIGINT).
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
      const sel = term.hasSelection() ? term.getSelection() : lastSelection;
      if (sel) {
        window.api.writeClipboard(sel);
        lastSelection = '';
        return false;
      }
    }

    return true;
  });

  term.onData((data) => {
    // Mouse/scroll events the TUI repaints in response (SGR `ESC [ <` or legacy
    // `ESC [ M`). Remember when one happened so the activity tracker can ignore
    // the repaint it triggers, instead of flickering idle -> busy on scroll.
    if (data.includes('\x1b[<') || data.includes('\x1b[M')) {
      const a = agents.get(id);
      if (a) a.lastMouseInput = Date.now();
    } else {
      // Real typed input invalidates the cached selection, so a later Ctrl+C
      // sends SIGINT instead of re-copying a stale selection.
      lastSelection = '';
    }
    window.api.sendInput(id, data);
  });

  // Refit whenever the panel changes size. Skipped while hidden (0 size),
  // so the pty is sized to the real visible panel, not the initial 80x30.
  // While the phone owns the pty size, only the local view refits: a layout
  // change here must not snap the phone's terminal back to desktop size.
  const refit = () => {
    if (el.clientHeight === 0 || el.clientWidth === 0) return;
    try {
      fit.fit();
      if (agents.get(id)?.sizeOwner === 'remote') return;
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
    search,
    el,
    ro,
    refit,
    remoteOverlay,
    order: restore?.order ?? Date.now(),
    status: 'busy',
    dotEl: null,
  });

  window.api.spawn(id, cwd, {
    bypass: settings.bypass,
    resume: restore?.sessionId || null,
    cols: opts.cols,
    rows: opts.rows,
  });
  if (opts.cols && opts.rows) {
    agents.get(id).sizeOwner = 'remote';
    syncRemoteOverlay(id);
  }
  persistAgents();
  notifyAgentsChanged();
  if (!opts.background) activate(id);
  return id;
}

// Resume a dormant agent into a live one, reopening its Claude session.
// `opts` as for spawn (phone-initiated resume). Returns the id, or null.
export function resume(id, opts = {}) {
  const d = dormant.get(id);
  if (!d) return null;
  dormant.delete(id);
  return spawn(
    d.dir,
    d.cwd,
    d.branch,
    d.isMain,
    {
      id: d.id,
      sessionId: d.sessionId,
      label: d.label,
      customLabel: d.customLabel,
      order: d.order,
    },
    opts
  );
}

// Forget a dormant agent for good (its session stays on disk but we stop
// tracking it). Used from the dormant row's kebab menu.
export function removeDormant(id) {
  dormant.delete(id);
  persistAgents();
  if (agents.size === 0 && dormant.size === 0) els.empty.style.display = '';
  notifyAgentsChanged();
}

// Forget every dormant record for a dir that's being torn down entirely
// (removeProject / removeWorkspace) — otherwise those rows linger in
// localStorage forever, pointing at a project that no longer exists.
export function pruneDormantForDir(dir, skipRender = false) {
  for (const [id] of dormantForDir(dir)) dormant.delete(id);
  persistAgents();
  if (agents.size === 0 && dormant.size === 0) els.empty.style.display = '';
  if (!skipRender) notifyAgentsChanged();
}

export async function renameAgent(id) {
  const a = agents.get(id) || dormant.get(id);
  if (!a) return;
  const current = displayLabel(a);
  const name = await promptText('Rename agent', current);
  if (!name) return;
  a.customLabel = name;
  persistAgents();
  notifyAgentsChanged();
}

// Sleep: stop the session but keep tracking it (it shows as Sleeping and can be
// resumed). A session that was never used has no transcript to resume, so it
// is simply closed.
export function sleepAgent(id) {
  removeAgent(id);
}

// Forget: stop the session and stop tracking it. With `deleteWorktree` a
// separate worktree's folder is removed too (and optionally its branch). The
// agent is always fully exited first: its cwd would otherwise keep a file lock
// on the folder. Dialog-free (desktop and phone confirm first); when git
// refuses, the agent stays tracked as sleeping and { needsForce } asks the
// caller to confirm a force remove. `prompt` lets git:delete-branch show its
// "force delete unmerged branch?" dialog (desktop only).
export async function forgetAgent(id, { deleteWorktree = false, deleteBranch = false, force = false, prompt = false } = {}) {
  const live = agents.get(id);
  const a = live || dormant.get(id);
  if (!a) throw new Error('Unknown agent.');
  const { dir, cwd, branch } = a;
  if (deleteWorktree && a.isMain) throw new Error('Only a separate worktree can be deleted.');
  if (live) await killAndWait(id);
  const untrack = () => (agents.has(id) ? cleanupAgent(id) : removeDormant(id));
  if (!deleteWorktree) {
    untrack();
    return { ok: true };
  }

  const res = await window.api.removeWorktree(dir, cwd, force);
  // A hard git refusal (locked/dirty worktree): it is still on disk, so keep it
  // tracked as sleeping — there must be a way back to it.
  if (res.error && !res.cleanupIncomplete) {
    if (agents.has(id)) convertToDormant(id);
    return { needsForce: !force, error: res.error };
  }
  untrack();
  // git won't delete a branch that's still checked out in a live worktree, so
  // only now that the worktree is gone.
  let branchError = null;
  if (deleteBranch && branch) {
    const del = await window.api.gitDeleteBranch(dir, branch, { noPrompt: !prompt });
    if (del.error && !del.cancelled) branchError = del.error;
  }
  return { ok: true, cleanupError: res.cleanupIncomplete ? res.error : null, branchError };
}

// Kill the agent's pty and resolve once it has actually exited (with a short
// grace period for the OS to release the cwd handle). Falls back on timeout.
export function killAndWait(id) {
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
  if (state.activeId === id) {
    state.activeId = null;
    updateStageBar();
  }
  // Reset the label counter once a project has no agents left, so a relaunch
  // starts back at "Agent 1" instead of climbing forever.
  if (agentsForDirCount(a.dir) === 0) agentSeq.delete(a.dir);
  if (agents.size === 0 && dormant.size === 0) els.empty.style.display = '';
  if (!skipRender) notifyAgentsChanged();
}

// pty exited on its own (Claude quit / app closed). If the agent carries a
// session id and the exit was not deliberate, keep it as a resumable dormant
// record instead of discarding it.
function convertToDormant(id, skipRender = false) {
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
  dormant.set(id, record(id, a));
  if (state.activeId === id) {
    state.activeId = null;
    updateStageBar();
  }
  persistAgents();
  if (!skipRender) notifyAgentsChanged();
}

// Reorder agents within a project: dropping `draggedId` onto `targetId`
// rewrites the dir's order indices so the sidebar (and persisted records) keep
// the new arrangement.
export function reorderAgent(draggedId, targetId) {
  const d = agents.get(draggedId);
  const t = agents.get(targetId);
  if (!d || !t || d.dir !== t.dir) return;
  const ids = agentsForDir(d.dir).map(([id]) => id).filter((id) => id !== draggedId);
  const at = ids.indexOf(targetId);
  ids.splice(at, 0, draggedId);
  ids.forEach((id, i) => {
    agents.get(id).order = i;
  });
  persistAgents();
  notifyAgentsChanged();
}

function agentsForDirCount(dir) {
  let n = 0;
  for (const a of agents.values()) if (a.dir === dir) n++;
  return n;
}

export function removeAgent(id, skipRender = false) {
  const a = agents.get(id);
  window.api.kill(id);
  // A resumable session (has a sessionId and was actually used) is preserved as
  // a dormant record instead of being discarded outright — same preservation
  // rule deleteWorktree and the pty-exit handler already apply.
  if (a && a.sessionId && a.used) convertToDormant(id, skipRender);
  else cleanupAgent(id, skipRender);
}

export function activate(id) {
  state.activeId = id;
  els.empty.style.display = 'none';
  for (const [aid, a] of agents) {
    a.el.classList.toggle('active', aid === id);
  }
  for (const row of [...els.list.querySelectorAll('.agent'), ...els.wsList.querySelectorAll('.agent')]) {
    row.classList.toggle('active', row.dataset.id === id);
  }
  const a = agents.get(id);
  if (a) {
    a.lastActive = Date.now();
    // Viewing an agent that finished while unfocused clears the "unseen" flag;
    // it stays as plain "done".
    if (a.status === 'unseen') setStatus(id, 'done');
    // While the phone has control this shows "Working remotely" (Take over
    // restarts it here); opening the agent alone doesn't take it back.
    requestAnimationFrame(() => {
      a.refit();
      a.term.focus();
    });
  }
  updateStageBar();
}

// ---------------------------------------------------------------------------
// Main-process streams
// ---------------------------------------------------------------------------

window.api.onData(({ id, data }) => {
  const a = agents.get(id);
  if (!a) return;
  a.term.write(data);
  detectPrompts(id, data);
  markActivity(id);
});

window.api.onExit(({ id, exitCode, error }) => {
  const a = agents.get(id);
  if (!a) return; // already cleaned up by a deliberate removal
  clearTimeout(a.idleTimer);

  // Release any kill waiter first (worktree removal needs the file lock gone).
  const resolve = pendingExit.get(id);
  if (resolve) {
    pendingExit.delete(id);
    setTimeout(resolve, 250); // grace for OS to release the cwd handle
  }

  // A spawn failure (bad cwd, claude not found, a broken --resume session) never
  // produced usable pty output. Writing it into the terminal is pointless when
  // the very next step below (convertToDormant) synchronously disposes that
  // terminal — the text never gets a chance to paint. Surface it via dialog
  // instead, and keep the dormant record intact (if any) so Resume can be
  // retried; a repeat failure re-shows this dialog every time.
  if (error) {
    if (a.sessionId && a.used && !a.intentional) convertToDormant(id);
    else if (!a.intentional) setStatus(id, 'error');
    else setStatus(id, 'dead');
    confirmDialog('Failed to start', error, { alert: true });
    return;
  }

  // Natural exit with a *used* session -> keep it resumable; otherwise dead.
  // (An untouched session has no transcript on disk, so resume would fail.)
  // A non-zero exit that wasn't a deliberate kill = flag it red.
  if (a.sessionId && a.used && !a.intentional) convertToDormant(id);
  else if (!a.intentional && exitCode) setStatus(id, 'error');
  else setStatus(id, 'dead');
});

// Hooks own the states activity can't infer: needs-input (blocked) and dead.
// busy/idle are driven by terminal activity above. The session id also arrives
// here (from the hook payload) — capture it, and mark the agent "used" once a
// prompt has been submitted (only then does Claude persist the transcript).
// Status transitions and sound/notification side effects live in
// agent-status.mjs (handleAgentEvent); this just wires the IPC event to it.
window.api.onEvent(handleAgentEvent);

// ---------------------------------------------------------------------------
// Remote access (phone app) — this renderer is the source of truth for agents,
// so main mirrors the list from here and asks us to run phone actions.
// ---------------------------------------------------------------------------

const remotePusher = createSnapshotPusher({
  build: () => buildRemoteSnapshot(agents, dormant, displayLabel),
  push: (snapshot) => window.api.pushRemoteAgents(snapshot),
});
onAgentsChanged(remotePusher.schedule);
onStatusChanged(remotePusher.schedule);

/** Push the first snapshot once startup state (dormant rows) is loaded. */
export function startRemoteSync() {
  remotePusher.schedule();
}

// Main tells us when the pty size changes hands without a restart (an agent
// with no session to resume).
window.api.onSizeOwner(({ id, owner }) => {
  const a = agents.get(id);
  if (!a) return;
  a.sizeOwner = owner;
  syncRemoteOverlay(id);
  remotePusher.schedule();
});

function syncRemoteOverlay(id) {
  const a = agents.get(id);
  if (a) a.remoteOverlay.hidden = a.sizeOwner !== 'remote';
}

// Hand an agent to a device by restarting its session there (--resume at that
// device's size): the app reprints the conversation at the new width, so the
// terminal on that device has a clean, complete scrollback. A turn in progress
// is interrupted (type "continue" to pick it up). Returns false
// when there is no session to resume yet (nothing was sent): callers fall back
// to a plain resize.
export async function restartFor(id, { owner, cols, rows }) {
  const a = agents.get(id);
  if (!a || !a.sessionId || !a.used || a.restarting) return false;
  a.restarting = true;
  a.sizeOwner = owner;
  syncRemoteOverlay(id);
  a.term.reset();
  try {
    return await window.api.restart(id, a.cwd, { bypass: settings.bypass, resume: a.sessionId, cols, rows, owner });
  } finally {
    a.restarting = false;
    remotePusher.schedule();
  }
}

// "Take over" on the desktop's "Working remotely" page.
async function takeOver(id) {
  const a = agents.get(id);
  if (!a) return;
  const dims = a.fit.proposeDimensions() || { cols: a.term.cols, rows: a.term.rows };
  const restarted = await restartFor(id, { owner: 'desktop', cols: dims.cols, rows: dims.rows });
  if (!restarted) {
    // No session to resume: just take the size back.
    a.sizeOwner = 'desktop';
    syncRemoteOverlay(id);
    a.refit();
    remotePusher.schedule();
  }
  a.term.focus();
}

const remoteCommands = {
  // Phone spawns follow the desktop's bypass setting (spawn() reads it), and
  // never steal the desktop's visible terminal.
  async spawn({ dir, cwd, cols, rows }) {
    const workspace = state.workspacesData.some((w) => w.dir === dir);
    const branch = workspace ? null : await window.api.gitBranch(cwd);
    const id = spawn(dir, cwd, branch, cwd === dir, null, { background: true, cols, rows });
    return { id };
  },
  resume({ id, cols, rows }) {
    if (!dormant.has(id)) throw new Error('Not a dormant agent.');
    return { id: resume(id, { background: true, cols, rows }) };
  },
  // The Claude session id behind an agent (live or dormant), for the phone's
  // history view; main reads the transcript itself.
  session({ id }) {
    const a = agents.get(id) || dormant.get(id);
    if (!a) throw new Error('Unknown agent.');
    return { sessionId: a.sessionId || null };
  },
  rename({ id, name }) {
    const a = agents.get(id) || dormant.get(id);
    if (!a) throw new Error('Unknown agent.');
    a.customLabel = name;
    persistAgents();
    notifyAgentsChanged();
    return { id };
  },
  // Same as the desktop menu's Forget (the phone confirms first).
  forget({ id, deleteWorktree, deleteBranch, force }) {
    return forgetAgent(id, { deleteWorktree, deleteBranch, force });
  },
  // The phone opens a terminal the desktop controls: restart it at the
  // phone's size ({ restarted: false } = no session yet, main falls back).
  async takeover({ id, owner, cols, rows }) {
    return { restarted: await restartFor(id, { owner, cols, rows }) };
  },
  // Same as the desktop menu's Sleep: a used session stays tracked (sleeping).
  kill({ id }) {
    if (!agents.has(id)) throw new Error('Agent is not running.');
    removeAgent(id);
    return { id };
  },
};

window.api.onRemoteCommand(async ({ reqId, op, args }) => {
  try {
    const fn = remoteCommands[op];
    if (!fn) throw new Error(`Unknown command: ${op}`);
    const result = await fn(args);
    window.api.sendRemoteCommandResult({ reqId, ok: true, result });
  } catch (err) {
    window.api.sendRemoteCommandResult({ reqId, ok: false, error: (err && err.message) || String(err) });
  }
});
