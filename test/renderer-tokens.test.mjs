import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Design-token guard for renderer/style.css: WCAG contrast for both themes, and
// the two reserved colours (--signal yellow, --select cyan) staying on their jobs.
const css = readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selectorRe) {
  const m = css.match(new RegExp(`${selectorRe}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `token block ${selectorRe} not found`);
  return Object.fromEntries([...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
}

const shared = block(':root\\s*,\\s*\\[data-theme=.dark.\\]');
const dark = { ...shared };
const light = { ...shared, ...block("\\[data-theme='light'\\]") };

function resolve(theme, name, seen = new Set()) {
  const v = theme[name];
  assert.ok(v, `token ${name} missing`);
  assert.ok(!seen.has(name), `token cycle at ${name}`);
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolve(theme, ref[1], new Set([...seen, name]));
  assert.match(v, /^#[0-9a-fA-F]{6}$/, `${name} must be a #rrggbb literal or var(), got ${v}`);
  return v;
}

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background, minimum]. Text = 4.5, non-text glyphs/squares = 3.
const PAIRS = [
  ['--fg', '--bg', 4.5], ['--fg', '--panel', 4.5], ['--fg', '--elevated', 4.5],
  ['--muted', '--bg', 4.5], ['--muted', '--panel', 4.5], ['--muted', '--elevated', 4.5],
  ['--danger', '--panel', 4.5], ['--add', '--bg', 4.5], ['--del', '--bg', 4.5],
  ['--on-action', '--action', 4.5], ['--select', '--panel', 3], ['--border-strong', '--panel', 3],
  ['--board-fg', '--board', 4.5], ['--board-fg', '--board-raised', 4.5],
  ['--board-muted', '--board', 4.5], ['--board-muted', '--board-raised', 4.5],
  ['--on-signal', '--signal', 4.5], ['--on-signal-muted', '--signal', 4.5],
  ['--board-select', '--board', 4.5], ['--st-error', '--board', 4.5], ['--st-rate', '--board', 4.5],
  ['--st-busy', '--board', 3], ['--st-idle', '--board', 3], ['--st-dormant', '--board', 3],
];

for (const [name, theme] of [['dark', dark], ['light', light]]) {
  test(`${name} theme meets WCAG contrast`, () => {
    const fails = PAIRS.map(([f, b, min]) => [f, b, min, ratio(resolve(theme, f), resolve(theme, b))])
      .filter(([, , min, r]) => r < min)
      .map(([f, b, min, r]) => `${f} on ${b}: ${r.toFixed(2)} < ${min}`);
    assert.deepEqual(fails, []);
  });
}

test('the board is the same slate field in both themes', () => {
  for (const t of ['--board', '--board-raised', '--board-fg']) assert.equal(resolve(light, t), resolve(dark, t), t);
});

// Each rule outside the token blocks: which selectors use the reserved colours.
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim(), body: m[2] }))
  .filter((r) => !/^:root|^\[data-theme/.test(r.sel));

test('--signal (yellow) is only used for needs-input', () => {
  const bad = rules.filter((r) => /var\(--signal\)/.test(r.body) && !/needs|band/.test(r.sel)).map((r) => r.sel);
  assert.deepEqual(bad, []);
});

test('--select (cyan) is only used for selection, focus and unseen', () => {
  const ok = /active|\.on\b|focus|checked|checkbox|selected|unseen|drop-target|dragging|resizing|current/;
  const bad = rules
    .filter((r) => /var\(--(board-)?select\)/.test(r.body))
    .flatMap((r) => r.sel.split(',').map((s) => s.trim()))
    .filter((s) => !ok.test(s));
  assert.deepEqual(bad, []);
});

test('no legacy colour tokens remain', () => {
  const legacy = css.match(/var\(--(accent|needs-input|unseen|ok)\b[^)]*\)/g) ?? [];
  assert.deepEqual(legacy, []);
});
