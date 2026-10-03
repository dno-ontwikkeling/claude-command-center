'use strict';

// ---------------------------------------------------------------------------
// Which phone notifications to raise or clear, from successive agent
// snapshots (the same list the phone gets in its `agents` frames). Electron-free
// and pure (see test/pushnotify.test.js).
//
//   needs-input  - an agent is waiting for the user; cleared once it is not.
//   finished     - a turn ended (working -> done/unseen, the Stop hook states);
//                  cleared when the agent works again, sleeps or disappears.
//
// The first snapshot only records state, so agents that finished long ago do
// not notify.
// ---------------------------------------------------------------------------

const WORKING = new Set(['busy', 'needs-input']);
const FINISHED = new Set(['done', 'unseen']);

function createPushNotifier() {
  let last = null; // id -> status of live agents in the previous snapshot
  const input = new Set(); // agents with a needs-input notification up
  const finished = new Set(); // agents with a finished notification up

  // list: [{ id, label, status, dormant }] -> { notify: [{kind,id,label}], dismiss: [{kind,id}] }
  function apply(list) {
    const live = new Map();
    const labels = new Map();
    for (const a of list) {
      labels.set(a.id, a.label || '');
      if (!a.dormant) live.set(a.id, a.status);
    }
    const prev = last;
    last = live;
    const notify = [];
    const dismiss = [];

    for (const [id, st] of live) {
      if (st === 'needs-input' && !input.has(id)) notify.push({ kind: 'needs-input', id, label: labels.get(id) });
    }
    for (const id of input) {
      if (live.get(id) !== 'needs-input') dismiss.push({ kind: 'needs-input', id });
    }
    input.clear();
    for (const [id, st] of live) if (st === 'needs-input') input.add(id);

    if (prev) {
      for (const [id, st] of live) {
        if (FINISHED.has(st) && WORKING.has(prev.get(id)) && !finished.has(id)) {
          notify.push({ kind: 'finished', id, label: labels.get(id) });
          finished.add(id);
        }
      }
    }
    for (const id of [...finished]) {
      const st = live.get(id);
      if (st === undefined || !FINISHED.has(st)) {
        finished.delete(id);
        dismiss.push({ kind: 'finished', id });
      }
    }
    return { notify, dismiss };
  }

  return { apply };
}

module.exports = { createPushNotifier };
