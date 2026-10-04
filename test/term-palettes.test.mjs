import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TERM_DARK, TERM_LIGHT } from '../renderer/term-palettes.mjs';

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const ALL = [...ANSI, ...ANSI.map((n) => 'bright' + n[0].toUpperCase() + n.slice(1))];

// On the dark terminal "black" is the background family; everything else is ink.
for (const [name, pal, skip] of [['dark', TERM_DARK, ['black']], ['light', TERM_LIGHT, []]]) {
  test(`${name} palette: foreground is at least 7:1 on the background`, () => {
    assert.ok(ratio(pal.foreground, pal.background) >= 7, ratio(pal.foreground, pal.background).toFixed(2));
  });

  test(`${name} palette: every ANSI ink colour is at least 3:1 on the background`, () => {
    const fails = ALL.filter((k) => !skip.includes(k))
      .map((k) => [k, ratio(pal[k], pal.background)])
      .filter(([, r]) => r < 3)
      .map(([k, r]) => `${k} ${pal[k]}: ${r.toFixed(2)}`);
    assert.deepEqual(fails, []);
  });
}

test('terminal backgrounds match the --term-bg tokens', () => {
  const css = readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8');
  const darkBg = css.match(/\[data-theme='dark'\]\s*\{[^}]*--term-bg:\s*(#[0-9a-f]{6})/i)[1];
  const lightBg = css.match(/\[data-theme='light'\]\s*\{[^}]*--term-bg:\s*(#[0-9a-f]{6})/i)[1];
  assert.equal(TERM_DARK.background.toLowerCase(), darkBg.toLowerCase());
  assert.equal(TERM_LIGHT.background.toLowerCase(), lightBg.toLowerCase());
});
