// Who controls an agent's terminal (pure, unit tested). The phone takes control
// by attaching (the PC restarts the session at the phone's size); the desktop
// can take it back. The agents snapshot says `remote: true` while the phone
// has control. Right after attaching, a snapshot from before the takeover may
// still say false, so control only counts as lost after the phone had it.
export function createControlTracker() {
  let had = false;
  return {
    /** @returns {'have' | 'lost' | 'pending'} */
    update(remote) {
      if (remote) {
        had = true;
        return 'have';
      }
      if (had) {
        had = false;
        return 'lost';
      }
      return 'pending';
    },
    reset() {
      had = false;
    },
  };
}
