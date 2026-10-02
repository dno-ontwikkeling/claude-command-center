// One-finger scrolling for the terminal. xterm.js has no usable touch
// scrolling, so the terminal screen turns finger movement into lines (or
// mouse-wheel events for full-screen apps such as Claude Code), with a
// momentum fling after release. Pure (unit tested).

const MAX_WHEEL_EVENTS = 50; // per call, so a fling can't flood the pty

// A wheel notch scrolls ~3 lines in most TUIs (Claude Code included), so one
// wheel event per 3 lines of finger travel keeps the content under the finger.
export const WHEEL_LINES = 3;

const VELOCITY_WINDOW_MS = 100;
const FRICTION_MS = 325; // time constant of the exponential decay
const MIN_VELOCITY = 0.05; // px/ms; slower than this, the fling stops

// Turns finger movement (px, positive = down) into whole steps to scroll
// (positive = forward/newer). Keeps the sub-step remainder between moves.
export function createLineAccumulator(stepPx) {
  const step = stepPx > 0 ? stepPx : 1;
  let carry = 0;
  return {
    move(dy) {
      carry -= dy;
      const lines = Math.trunc(carry / step);
      carry -= lines * step;
      return lines;
    },
    reset() {
      carry = 0;
    },
  };
}

// SGR mouse-wheel events at a 1-based cell: button 64 = wheel up (back),
// 65 = wheel down (forward).
export function wheelSequence(steps, col, row) {
  const n = Math.min(Math.abs(steps), MAX_WHEEL_EVENTS);
  const c = Math.max(1, Math.trunc(col) || 1);
  const r = Math.max(1, Math.trunc(row) || 1);
  return `\x1b[<${steps < 0 ? 64 : 65};${c};${r}M`.repeat(n);
}

// Finger velocity (px/ms, positive = down) over the last ~100ms.
export function createVelocityTracker() {
  let samples = [];
  return {
    add(t, y) {
      samples.push({ t, y });
      samples = samples.filter((s) => t - s.t <= VELOCITY_WINDOW_MS);
    },
    velocity(now = samples.length ? samples[samples.length - 1].t : 0) {
      const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
      if (recent.length < 2) return 0;
      const a = recent[0];
      const b = recent[recent.length - 1];
      return b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
    },
    reset() {
      samples = [];
    },
  };
}

// One animation frame of a fling: the distance to move this frame and the
// decayed velocity for the next, or null once it is too slow to continue.
export function momentumStep(v, dtMs) {
  if (!Number.isFinite(v) || Math.abs(v) < MIN_VELOCITY) return null;
  return { dy: v * dtMs, v: v * Math.exp(-dtMs / FRICTION_MS) };
}

// Fastest fling (px/ms), so stacked flicks can't spin the pty into a flood.
export const MAX_VELOCITY = 8;

// Native fling feel: flicking again in the same direction while the content
// is still rolling adds to its speed; a flick the other way or a tap (0)
// starts fresh.
export function stackVelocity(rolling, flick) {
  const same = rolling && flick && Math.sign(rolling) === Math.sign(flick);
  const v = same ? rolling + flick : flick;
  return Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, v));
}
