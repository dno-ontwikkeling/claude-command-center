// Pinch-to-zoom for the terminal font. Pure (unit tested).

const MIN = 8;
const MAX = 24; // same range as term-settings

export function touchDistance(a, b) {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

// Font size after pinching by `scale` (current distance / start distance).
export function fontSizeFromPinch(startSize, scale) {
  if (!Number.isFinite(scale) || scale <= 0) return startSize;
  return Math.min(MAX, Math.max(MIN, Math.round(startSize * scale)));
}
