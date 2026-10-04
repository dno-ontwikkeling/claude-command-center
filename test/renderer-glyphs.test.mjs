import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Icons come from renderer/icons.mjs (one stroke-based SVG set), never from
// text glyphs, which render at the mercy of whatever font has them.
const GLYPHS = /[◐＋✦⚙✕▲▼▸▾⋮⟳✚✎⠿]|🗑/u;
const dir = new URL('../renderer/', import.meta.url);

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');

test('no text-glyph icons in renderer markup or JS', () => {
  const files = readdirSync(dir).filter((f) => /\.(html|js|mjs)$/.test(f));
  const hits = [];
  for (const f of files) {
    stripComments(readFileSync(new URL(f, dir), 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        if (GLYPHS.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});
