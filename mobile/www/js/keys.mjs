// Extra-keys bar: keys a phone keyboard lacks, as terminal byte sequences.
// Pure (unit tested).

const SEQ = {
  esc: '\x1b',
  tab: '\t',
  'shift-tab': '\x1b[Z',
  enter: '\r',
  // Claude Code treats ESC+CR as "insert newline" (the desktop's Ctrl+Enter).
  newline: '\x1b\r',
};

const ARROWS = { up: 'A', down: 'B', right: 'C', left: 'D' };

/** Bar layout; `ctrl` is a latch applied to the next typed character. */
export const EXTRA_KEYS = [
  { id: 'newline', label: '↵ line' },
  { id: 'esc', label: 'Esc' },
  { id: 'ctrl', label: 'Ctrl' },
  { id: 'tab', label: 'Tab' },
  { id: 'shift-tab', label: '⇧Tab' },
  { id: 'up', label: '↑' },
  { id: 'down', label: '↓' },
  { id: 'left', label: '←' },
  { id: 'right', label: '→' },
  { id: 'enter', label: 'Enter' },
];

// appCursor: the app enabled DECCKM (application cursor keys), so arrows use SS3.
export function keySequence(id, { appCursor = false } = {}) {
  if (id in ARROWS) return `\x1b${appCursor ? 'O' : '['}${ARROWS[id]}`;
  return SEQ[id] || '';
}

// Ctrl+<char> as a control code, or null when there is no such code.
export function ctrlOf(ch) {
  if (ch.length !== 1) return null;
  const c = ch.toLowerCase();
  if (c >= 'a' && c <= 'z') return String.fromCharCode(c.charCodeAt(0) - 96);
  const special = { '@': 0x00, ' ': 0x00, '[': 0x1b, '\\': 0x1c, ']': 0x1d, '^': 0x1e, _: 0x1f, '?': 0x7f };
  return c in special ? String.fromCharCode(special[c]) : null;
}

// Apply a latched Ctrl to typed input. Only a single mappable character
// consumes the latch; paste or an unmappable key passes through untouched.
export function applyCtrl(data, ctrlLatched) {
  if (!ctrlLatched) return { data, consumed: false };
  const code = ctrlOf(data);
  return code === null ? { data, consumed: false } : { data: code, consumed: true };
}
