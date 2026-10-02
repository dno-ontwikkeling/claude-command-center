import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  normalize,
  resolveTheme,
  palette,
  xtermOptions,
  createSettingsStore,
} from '../www/js/term-settings.mjs';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => (data[k] = String(v)),
    data,
  };
}

test('phone defaults (independent of the desktop)', () => {
  assert.deepEqual(DEFAULTS, { fontSize: 11, fontFamily: 'monospace', theme: 'system', scrollback: 5000 });
});

test('normalize clamps and fills in bad values', () => {
  assert.deepEqual(normalize({ fontSize: 3, scrollback: 99999999, theme: 'neon', fontFamily: '' }), {
    fontSize: 8,
    fontFamily: 'monospace',
    theme: 'system',
    scrollback: 20000,
  });
  assert.equal(normalize({ fontSize: 40 }).fontSize, 24);
  assert.equal(normalize({ fontSize: 12.7 }).fontSize, 13);
  assert.equal(normalize({ scrollback: 10 }).scrollback, 500);
  assert.equal(normalize({ fontSize: 'big' }).fontSize, 11);
  assert.equal(normalize(null).fontSize, 11);
});

test('resolveTheme follows the phone OS for "system"', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('palettes are complete xterm themes and differ per theme', () => {
  for (const t of ['dark', 'light']) {
    const p = palette(t);
    for (const k of ['background', 'foreground', 'cursor', 'black', 'red', 'green', 'brightWhite']) {
      assert.match(p[k], /^#[0-9A-Fa-f]{6,8}$/, `${t}.${k}`);
    }
  }
  assert.notEqual(palette('dark').background, palette('light').background);
});

test('xtermOptions maps settings to terminal options', () => {
  const o = xtermOptions({ ...DEFAULTS, theme: 'light' }, true);
  assert.equal(o.fontSize, 11);
  assert.equal(o.scrollback, 5000);
  assert.equal(o.theme.background, palette('light').background);
});

test('store: loads saved settings, survives corrupt JSON, persists updates', () => {
  const s1 = createSettingsStore(memoryStorage({ 'cc.termSettings': '{"fontSize":14}' }));
  assert.equal(s1.get().fontSize, 14);
  assert.equal(s1.get().scrollback, 5000);

  const corrupt = createSettingsStore(memoryStorage({ 'cc.termSettings': '{nope' }));
  assert.deepEqual(corrupt.get(), DEFAULTS);

  const storage = memoryStorage();
  const s2 = createSettingsStore(storage);
  s2.update({ fontSize: 99 });
  assert.equal(s2.get().fontSize, 24);
  assert.equal(JSON.parse(storage.data['cc.termSettings']).fontSize, 24);
  assert.equal(createSettingsStore(storage).get().fontSize, 24, 'survives an app restart');
});

test('store: subscribers hear normalized updates; unsubscribe stops them', () => {
  const s = createSettingsStore(memoryStorage());
  const seen = [];
  const off = s.subscribe((v) => seen.push(v.fontSize));
  s.update({ fontSize: 13 });
  off();
  s.update({ fontSize: 15 });
  assert.deepEqual(seen, [13]);
});

test('store: a storage that throws (private mode) still works in memory', () => {
  const s = createSettingsStore({
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  });
  assert.deepEqual(s.get(), DEFAULTS);
  s.update({ fontSize: 12 });
  assert.equal(s.get().fontSize, 12);
});
