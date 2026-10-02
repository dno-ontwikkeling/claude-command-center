'use strict';

// ---------------------------------------------------------------------------
// Pure helpers for mirroring the agent list to the phone app (via main). No DOM
// or window.api use, so they're unit tested (test/remote-sync.test.mjs); the
// wiring (subscriptions, window.api calls, remote commands) lives in agents.js.
// ---------------------------------------------------------------------------

// The wire shape (see test/fixtures/remote-proto/frames.json `agents` list).
// `label` is the same display label the sidebar shows (passed in, so this
// module stays free of state.js imports).
export function buildRemoteSnapshot(agents, dormant, displayLabel) {
  const out = [];
  for (const [id, a] of agents) {
    out.push({
      id,
      label: displayLabel(a),
      dir: a.dir,
      cwd: a.cwd,
      branch: a.branch ?? null,
      isMain: a.isMain !== false,
      status: a.status || 'busy',
      dormant: false,
    });
  }
  for (const [id, d] of dormant) {
    out.push({
      id,
      label: displayLabel(d),
      dir: d.dir,
      cwd: d.cwd,
      branch: d.branch ?? null,
      isMain: d.isMain !== false,
      status: 'dead',
      dormant: true,
    });
  }
  return out;
}

export function snapshotChanged(prev, next) {
  return prev === null || JSON.stringify(prev) !== JSON.stringify(next);
}

// Debounced, change-only pusher. Status flips busy<->idle on every output lull,
// so bursts are coalesced and identical snapshots never cross IPC. `seq`
// increments per push so main can drop out-of-order snapshots.
export function createSnapshotPusher({ build, push, delayMs = 150, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let last = null;
  let seq = 0;
  function flush() {
    timer = null;
    const list = build();
    if (!snapshotChanged(last, list)) return;
    last = list;
    push({ seq: ++seq, list });
  }
  return {
    schedule() {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(flush, delayMs);
    },
  };
}

// Terminal reports xterm sends on its own while a TUI tracks the mouse (?1000/
// ?1002/?1003, SGR or legacy) or focus (?1004): hovering or switching windows
// produces them. Only real keys mean "the user is working here now".
const AUTO_REPORTS = /\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[M[\s\S]{3}|\x1b\[[IO]/g;

/** True when terminal input data contains something the user typed. */
export function isUserInput(data) {
  return String(data).replace(AUTO_REPORTS, '').length > 0;
}
