'use strict';

// ---------------------------------------------------------------------------
// Agent status state machine: setStatus/markActivity/detectPrompts plus the
// hook-driven onEvent status handling and its sound/notification side effects.
// Split out of agents.js (which still owns pty/dormant lifecycle and wires
// window.api.onData/onExit/onEvent to the functions here) so the status logic
// can be read/maintained on its own, mirroring how renderer/agent-git.mjs and
// renderer/tui-signals.mjs are split out.
// ---------------------------------------------------------------------------

import { agents, state, displayLabel, persistAgents } from './state.js';
import { settings } from './settings.js';
import { beep } from './sound.js';
import { classifyOutput } from './tui-signals.mjs';

export function setStatus(id, status) {
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
export function markActivity(id) {
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
export function detectPrompts(id, data) {
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

// Hooks own the states activity can't infer: needs-input (blocked) and dead.
// busy/idle are driven by terminal activity (markActivity/detectPrompts). The
// session id also arrives here (from the hook payload) — capture it, and mark
// the agent "used" once a prompt has been submitted (only then does Claude
// persist the transcript). Wired to window.api.onEvent by agents.js.
export function handleAgentEvent({ agentId, status, sessionId, event, message }) {
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
}

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
