'use strict';

// xterm.js themes for the Departure Hall look. Backgrounds equal the CSS
// --term-bg tokens so the gutter around the terminal is seamless; ANSI colours
// are tuned for contrast on those backgrounds (test/term-palettes.test.mjs).
// Yellow stays a muted amber so terminal output never mimics the "needs you"
// signal yellow of the board.

export const TERM_DARK = {
  background: '#0a0e11',
  foreground: '#d5dce1',
  cursor: '#e6ebee',
  cursorAccent: '#0a0e11',
  selectionBackground: '#5bc0d640',
  black: '#1a232b',
  red: '#ef6f5e',
  green: '#7fd49b',
  yellow: '#e0b252',
  blue: '#6fa8f5',
  magenta: '#c79bf2',
  cyan: '#63c5c9',
  white: '#c3ccd3',
  brightBlack: '#6c7a85',
  brightRed: '#ff8a7a',
  brightGreen: '#9be3b2',
  brightYellow: '#f5d27a',
  brightBlue: '#93bfff',
  brightMagenta: '#dcb8ff',
  brightCyan: '#8adcdd',
  brightWhite: '#f4f7f8',
};

export const TERM_LIGHT = {
  background: '#fafaf7',
  foreground: '#1e2328',
  cursor: '#14181b',
  cursorAccent: '#fafaf7',
  selectionBackground: '#12748a33',
  black: '#1e2328',
  red: '#b93a2b',
  green: '#1d7a45',
  yellow: '#8a6400',
  blue: '#1f5fbf',
  magenta: '#8e3fb5',
  cyan: '#0f7480',
  // "white" text on a light terminal would vanish; render it as quiet ink.
  white: '#59636b',
  brightBlack: '#6b747b',
  brightRed: '#c9422f',
  brightGreen: '#23864f',
  brightYellow: '#946c00',
  brightBlue: '#2b6bcb',
  brightMagenta: '#9b4bc2',
  brightCyan: '#137e8a',
  brightWhite: '#2a3036',
};
