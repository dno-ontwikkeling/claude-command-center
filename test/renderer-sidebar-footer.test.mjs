import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static guard for the board footer: Prompts and Settings share one row in two
// exactly equal halves, and their labels truncate instead of wrapping. The
// renderer has no DOM tests, so this checks the markup and the CSS rules.
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('renderer/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const html = read('renderer/index.html');

function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `rule ${selector} not found`);
  return Object.fromEntries([...m[1].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
}

test('footer holds exactly Prompts then Settings, each with an icon and a label span', () => {
  const m = html.match(/<footer class="sidebar-footer">([\s\S]*?)<\/footer>/);
  assert.ok(m, 'sidebar footer not found');
  const buttons = [...m[1].matchAll(/<button id="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(buttons.map((b) => b[1]), ['prompts-btn', 'settings-btn']);
  for (const [, id, inner] of buttons) {
    assert.match(inner, /<svg[\s\S]*<\/svg>/, `${id} lost its icon`);
    assert.match(inner, /<span>[^<]+<\/span>/, `${id} lost its label span`);
  }
});

test('footer is a two-column grid of exactly equal halves', () => {
  const f = rule('.sidebar-footer');
  assert.equal(f.display, 'grid');
  // minmax(0, 1fr), not 1fr: a plain 1fr keeps a min-content floor, so a longer
  // label would take more than half.
  assert.equal(f['grid-template-columns'].replace(/\s+/g, ' '), 'repeat(2, minmax(0, 1fr))');
});

test('footer buttons can shrink and their labels truncate with an ellipsis', () => {
  const b = rule('.settings-btn');
  assert.equal(b['min-width'], '0');
  const s = rule('.settings-btn span');
  assert.equal(s.overflow, 'hidden');
  assert.equal(s['text-overflow'], 'ellipsis');
  assert.equal(s['white-space'], 'nowrap');
  assert.equal(rule('.settings-btn svg')['flex-shrink'], '0');
});
