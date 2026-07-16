'use strict';

/* global Terminal, FitAddon, SearchAddon, WebLinksAddon */

import { els } from './dom.js';
import { agents, agentSeq, pendingExit, dormant, state, persistAgents, agentsForDir, dormantForDir, notifyAgentsChanged, record, displayLabel } from './state.js';
import { settings, termOpts } from './settings.js';
import { confirmDialog, promptText, closeMenu } from './modals.js';
import { updateStageBar, openSearch } from './stage.js';
import { beep } from './sound.js';
import { classifyOutput } from './tui-signals.mjs';

// ---------------------------------------------------------------------------
// Agents / terminals
// ---------------------------------------------------------------------------

// Right-click terminal menu. Claude's TUI turns on mouse tracking, which
// swallows plain drag-select and the browser's native menu, so we give an
// explicit Copy/Paste path here. Reuses the kebab `.menu` styling.
function closeTermMenu() {
  document.getElementById('term-menu')?.remove();
}

function openTermMenu(x, y, term) {
  closeMenu(); // dismiss any open kebab menu
  closeTermMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.id = 'term-menu';
  const items = [
    { label: 'Copy', disabled: !term.hasSelection(), action: () => window.api.writeClipboard(term.getSelection()) },
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
export function spawn(dir, cwd, branch, isMain, restore = null) {
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

  // Select-to-copy (Linux-terminal style). Mouse tracking eats plain
  // drag-select while Claude is grabbing the mouse; hold Shift to force a
  // local selection in any mode (xterm built-in). On mouseup, push whatever
  // is selected to the clipboard so no Ctrl+C is needed.
  el.addEventListener('mouseup', () => {
    if (settings.copyOnSelect && term.hasSelection()) {
      window.api.writeClipboard(term.getSelection());
    }
  });

  // Right-click -> Copy/Paste menu at the cursor.
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openTermMenu(e.clientX, e.clientY, term);
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

    // Ctrl+V -> paste from the system clipboard.
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V')) {
      const text = window.api.readClipboard();
      if (text) term.paste(text);
      return false;
    }

    // Ctrl+C -> copy when text is selected; otherwise let it through as SIGINT.
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
      if (term.hasSelection()) {
        window.api.writeClipboard(term.getSelection());
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
    }
    window.api.sendInput(id, data);
  });

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
    search,
    el,
    ro,
    refit,
    order: restore?.order ?? Date.now(),
    status: 'busy',
    dotEl: null,
  });

  window.api.spawn(id, cwd, { bypass: settings.bypass, resume: restore?.sessionId || null });
  persistAgents();
  notifyAgentsChanged();
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
    order: d.order,
  });
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
  const a = agents.get(id);
  if (!a) return;
  const current = displayLabel(a);
  const name = await promptText('Rename worktree', current);
  if (!name) return;
  a.customLabel = name;
  persistAgents();
  notifyAgentsChanged();
}

export async function deleteWorktree(id) {
  const a = agents.get(id);
  if (!a) return;
  const { dir, cwd, branch } = a;
  const answer = await confirmDialog('Delete worktree', `This deletes the worktree from disk:\n\n${cwd}`, {
    okLabel: 'Delete',
    danger: true,
    checkbox: branch ? `Also delete the local branch “${branch}”` : null,
  });
  // checkbox makes confirmDialog resolve { ok, checked }; otherwise a boolean.
  const ok = typeof answer === 'object' ? answer.ok : answer;
  const alsoBranch = typeof answer === 'object' ? answer.checked : false;
  if (!ok) return;

  // Kill the agent first and wait for the process to exit, otherwise its cwd
  // keeps a file lock on the folder and git/Windows can't remove it.
  await killAndWait(id);

  let res = await window.api.removeWorktree(dir, cwd, false);
  // A hard git refusal (locked/dirty worktree) — offer a force remove. A merely
  // incomplete on-disk cleanup (cleanupIncomplete) is git-side success and is
  // reported separately below, not force-retried.
  if (res.error && !res.cleanupIncomplete) {
    const force = await confirmDialog('Force remove worktree', `git refused:\n\n${res.error}\n\nForce remove? This discards uncommitted changes.`, {
      okLabel: 'Force remove',
      danger: true,
    });
    if (force) res = await window.api.removeWorktree(dir, cwd, true);
  }
  if (res.cleanupIncomplete) {
    // git unregistered the worktree but its folder couldn't be fully deleted —
    // tell the user rather than silently claiming a clean removal.
    await confirmDialog('Cleanup incomplete', res.error, { alert: true });
  } else if (res.error) {
    await confirmDialog('Removal failed', res.error, { alert: true });
  }

  // The worktree registration is gone if git succeeded outright OR left only a
  // locked-folder remnant. Delete the branch only then (git won't delete a
  // branch that's still checked out in a live worktree).
  const worktreeGone = !res.error || res.cleanupIncomplete;
  if (alsoBranch && branch && worktreeGone) {
    const del = await window.api.gitDeleteBranch(dir, branch);
    // cancelled = the user declined the force-delete warning; not an error.
    if (del.error && !del.cancelled) await confirmDialog('Branch deletion failed', del.error, { alert: true });
  }

  // The pty is already dead (we had to kill it to release the cwd lock before
  // git could touch the folder). If the worktree is really gone, drop the row
  // for good. But if removal was aborted or failed outright, the worktree +
  // branch still exist on disk — keep the session as a resumable dormant record
  // so there's a UI path back, instead of silently forgetting it.
  if (res.error && !res.cleanupIncomplete) convertToDormant(id);
  else cleanupAgent(id);
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
  for (const row of els.list.querySelectorAll('.agent')) {
    row.classList.toggle('active', row.dataset.id === id);
  }
  const a = agents.get(id);
  if (a) {
    a.lastActive = Date.now();
    // Viewing an agent that finished while unfocused clears the "unseen" flag;
    // it stays as plain "done".
    if (a.status === 'unseen') setStatus(id, 'done');
    requestAnimationFrame(() => {
      a.refit();
      a.term.focus();
    });
  }
  updateStageBar();
}

function setStatus(id, status) {
  const a = agents.get(id);
  if (!a) return;
  a.status = status;
  if (a.dotEl) a.dotEl.className = `dot ${status}`;
}

// Manual override from the sidebar menu. A one-shot reset: clears the flags
// that pin auto-states (awaitingInput/rateResetAt) and the idle timer, then
// sets the dot. Not a permanent lock — real terminal activity or the next hook
// resumes automatic control, which is what you want after nudging a stuck dot.
export function forceStatus(id, status) {
  const a = agents.get(id);
  if (!a) return;
  a.awaitingInput = status === 'needs-input';
  a.rateResetAt = null;
  clearTimeout(a.idleTimer);
  setStatus(id, status);
}

const IDLE_AFTER_MS = 1200;
// Window after a scroll/mouse event during which repaint output is ignored.
const MOUSE_QUIET_MS = 400;

// Terminal output flowing = busy; quiet for IDLE_AFTER_MS = idle. This covers
// the gap hooks can't see (e.g. a freshly started agent sitting at its prompt).
function markActivity(id) {
  const a = agents.get(id);
  if (!a) return;
  // Activity only drives the busy<->idle pair. Every other state is "settled"
  // and owned elsewhere (needs-input/done/unseen by hooks, error/dead by exit,
  // rate-limited by output). A bare repaint must not knock those back to busy —
  // notably scrolling, which sends mouse events the TUI repaints in response.
  if (a.status !== 'busy' && a.status !== 'idle') return;
  if (a.awaitingInput) return;
  // Output arriving right after a scroll/mouse event is the TUI repainting, not
  // the agent working — don't let it flip an idle agent to busy.
  if (a.lastMouseInput && Date.now() - a.lastMouseInput < MOUSE_QUIET_MS) return;
  setStatus(id, 'busy');
  clearTimeout(a.idleTimer);
  a.idleTimer = setTimeout(() => {
    // Only demote a still-busy agent. done/unseen/needs-input/error/rate-limited
    // are owned elsewhere and must not be clobbered by a lull in output.
    const x = agents.get(id);
    if (x && x.status === 'busy') setStatus(id, 'idle');
  }, IDLE_AFTER_MS);
}

// PTY-output fallback for states the hooks can't see. Claude's inline
// permission prompts and rate-limit notices don't fire a Notification hook, so
// we sniff them straight out of the terminal stream (classifyOutput in
// tui-signals.mjs). Hooks stay authoritative; this only fills the gaps.
// Idempotent — fine to re-match on every TUI redraw.
function detectPrompts(id, data) {
  const a = agents.get(id);
  if (!a || a.status === 'dead') return;

  const { kind, resetAt } = classifyOutput(data);

  // Agent is working: lift any settled state (needs-input after a question was
  // answered, rate-limited after resume, done/unseen after a finished turn) back
  // to busy. markActivity arms the idle timer; awaitingInput must clear or it'd
  // re-pin on the next redraw. Working always wins (checked first in classify).
  if (kind === 'working') {
    a.awaitingInput = false;
    a.rateResetAt = null;
    if (a.status !== 'busy') setStatus(id, 'busy');
    markActivity(id);
    return;
  }

  // Rate limit: no hook exists for this. Pin the status (markActivity skips it)
  // until a UserPromptSubmit shows the user has resumed.
  if (kind === 'rate-limited') {
    a.rateResetAt = resetAt;
    a.awaitingInput = false;
    clearTimeout(a.idleTimer);
    setStatus(id, 'rate-limited');
    return;
  }

  // A selectable prompt = blocked on the user. Reuse awaitingInput so the
  // activity tracker won't flip back to busy on the TUI's constant redraws;
  // the existing UserPromptSubmit handler clears it.
  if (kind === 'needs-input') {
    a.awaitingInput = true;
    clearTimeout(a.idleTimer);
    setStatus(id, 'needs-input');
  }
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
window.api.onEvent(({ agentId, status, sessionId, event, message }) => {
  const a = agents.get(agentId);
  if (!a) return;
  if (sessionId && a.sessionId !== sessionId) a.sessionId = sessionId;
  if (event === 'UserPromptSubmit' && !a.used) a.used = true;
  if (sessionId || event === 'UserPromptSubmit') persistAgents();

  if (status === 'busy') {
    // Any busy hook (SessionStart / UserPromptSubmit / PreToolUse) means the
    // agent is working again. Lift it out of any settled state — including
    // done/unseen from a previously finished turn — and drive the dot.
    // markActivity only promotes busy/idle, so a settled state would otherwise
    // stay put; set busy explicitly, then arm the idle fallback timer.
    a.awaitingInput = false;
    a.rateResetAt = null;
    setStatus(agentId, 'busy');
    markActivity(agentId);
  } else if (status === 'needs-input') {
    // Claude fires Notification for two very different situations: a genuine
    // block (a permission prompt — "…needs your permission to use…") and a
    // benign "waiting for your input" nudge that arrives after a turn already
    // ended via Stop. Only the former is a sticky red blocked state; the latter
    // must not pin the dot red forever, so treat it as idle. Missing message =
    // assume blocking (safe default for older Claude builds).
    const blocking = !message || /permission/i.test(message);
    if (blocking) {
      a.awaitingInput = true;
      clearTimeout(a.idleTimer);
      setStatus(agentId, 'needs-input');
      notify(a, 'needs-input');
    } else {
      // Idle nudge: the turn is over, nothing is blocked. Don't override a
      // settled done/unseen; only demote a lingering busy/needs-input.
      a.awaitingInput = false;
      clearTimeout(a.idleTimer);
      if (a.status === 'busy' || a.status === 'needs-input') setStatus(agentId, 'idle');
    }
  } else if (status === 'idle') {
    // Stop hook: Claude finished a turn. "done" if you're watching it, "unseen"
    // (attention-grabbing) if it wrapped up on a tab you weren't looking at.
    a.awaitingInput = false;
    clearTimeout(a.idleTimer);
    const watching = agentId === state.activeId && document.hasFocus();
    setStatus(agentId, watching ? 'done' : 'unseen');
    if (!watching || settings.alwaysSound) notify(a, 'done');
  } else if (status === 'dead') {
    clearTimeout(a.idleTimer);
    setStatus(agentId, 'dead');
  }
});

// ---------------------------------------------------------------------------
// Notifications — a bell + OS toast when an agent needs input or finishes
// while you're not looking. Both are opt-out via settings.
// ---------------------------------------------------------------------------

function notify(a, kind) {
  const label = displayLabel(a);
  if (settings.sound) beep(kind, settings.soundType, settings.volume);
  // Don't pop an OS toast while the app is focused — the dot already shows it.
  if (settings.notifications && !document.hasFocus()) {
    const body = kind === 'needs-input' ? 'needs your input' : 'finished';
    try {
      new Notification('Command Center', { body: `${label} ${body}` });
    } catch {
      /* notifications unavailable */
    }
  }
}
