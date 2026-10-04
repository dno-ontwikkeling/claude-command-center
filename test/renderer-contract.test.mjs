import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The renderer has no DOM tests. This guards the wiring instead: every element
// renderer/dom.js looks up by ID must still exist in index.html, so a markup
// restructure can't silently drop a button the JS listens on.
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('every ID in renderer/dom.js exists in renderer/index.html', () => {
  const dom = read('renderer/dom.js');
  const html = read('renderer/index.html');
  const ids = [...dom.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 50, `expected the full ID map, found ${ids.length}`);
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const missing = ids.filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, []);
});
