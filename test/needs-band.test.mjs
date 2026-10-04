import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandModel, BAND_CAP } from '../renderer/needs-band.mjs';

const agent = (over) => ({ dir: 'C:/p/app', status: 'busy', label: 'agent 1', ...over });
const names = (dir) => ({ 'C:/p/app': 'app', 'C:/p/lib': 'lib' })[dir] ?? null;

test('empty when no agent needs input', () => {
  const m = bandModel([['a', agent()], ['b', agent({ status: 'unseen' })]], names);
  assert.deepEqual(m, { items: [], more: 0 });
});

test('lists needs-input agents oldest first with project, label and message', () => {
  const m = bandModel(
    [
      ['new', agent({ status: 'needs-input', needsSince: 200, branch: 'feat/x', dir: 'C:/p/lib' })],
      ['old', agent({ status: 'needs-input', needsSince: 100, customLabel: 'Review', blockMessage: 'Claude needs your permission to use Bash' })],
    ],
    names,
  );
  assert.deepEqual(m.items, [
    { id: 'old', label: 'Review', project: 'app', message: 'Claude needs your permission to use Bash' },
    { id: 'new', label: 'feat/x', project: 'lib', message: null },
  ]);
  assert.equal(m.more, 0);
});

test('label falls back from custom label to branch to generated label', () => {
  const m = bandModel([['a', agent({ status: 'needs-input', needsSince: 1 })]], names);
  assert.equal(m.items[0].label, 'agent 1');
});

test('caps the band and reports the overflow', () => {
  const list = Array.from({ length: BAND_CAP + 2 }, (_, i) => [`a${i}`, agent({ status: 'needs-input', needsSince: i })]);
  const m = bandModel(list, names);
  assert.equal(BAND_CAP, 3);
  assert.deepEqual(m.items.map((x) => x.id), ['a0', 'a1', 'a2']);
  assert.equal(m.more, 2);
});

test('unknown project dir falls back to the folder name', () => {
  const m = bandModel([['a', agent({ status: 'needs-input', needsSince: 1, dir: 'C:\\work\\tool' })]], names);
  assert.equal(m.items[0].project, 'tool');
});
