// One-finger scrolling for the terminal. xterm.js has no usable touch
// scrolling, so the terminal screen turns finger movement into lines.
// Pure (unit tested).

const MAX_WHEEL_LINES = 50; // per touchmove, so a fling can't flood the pty

// Turns finger movement (px, positive = down) into whole lines to scroll
// (positive = forward/newer). Keeps the sub-line remainder between moves.
export function createLineAccumulator(lineHeight) {
  const step = lineHeight > 0 ? lineHeight : 1;
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

// SGR mouse-wheel events for full-screen apps that track the mouse:
// button 64 = wheel up (back), 65 = wheel down (forward).
export function wheelSequence(lines) {
  const n = Math.min(Math.abs(lines), MAX_WHEEL_LINES);
  return (lines < 0 ? '\x1b[<64;1;1M' : '\x1b[<65;1;1M').repeat(n);
}
