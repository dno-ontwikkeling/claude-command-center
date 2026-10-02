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
      // The phone has control (the desktop shows "Working remotely").
      remote: a.sizeOwner === 'remote',
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
      remote: false,
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
