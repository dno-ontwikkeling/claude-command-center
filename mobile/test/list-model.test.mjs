import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAgents, agentActions,
  groupAgents,
  bannerFor,
  statusText,
  spawnTargets,
  estimateTermSize,
  dirName,
} from '../www/js/list-model.mjs';

const A = (id, dir, extra = {}) => ({ id, label: id, dir, cwd: dir, branch: null, status: 'idle', dormant: false, ...extra });

test('groups agents by project dir in first-seen order, live before dormant', () => {
  const groups = groupAgents([
    A('a1', 'C:\\p\\alpha'),
    A('a2', 'C:\\p\\beta', { dormant: true, status: 'dead' }),
    A('a3', 'C:\\p\\alpha', { dormant: true, status: 'dead' }),
    A('a4', 'C:\\p\\beta'),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.name, g.live.map((a) => a.id), g.dormant.map((a) => a.id)]),
    [
      ['alpha', ['a1'], ['a3']],
      ['beta', ['a4'], ['a2']],
    ],
  );
});

test('needs-input groups float to the top', () => {
  const groups = groupAgents([A('a1', '/p/one'), A('a2', '/p/two', { status: 'needs-input' })]);
  assert.equal(groups[0].name, 'two');
  assert.equal(groups[0].needsInput, true);
});

test('dirName handles Windows and POSIX paths', () => {
  assert.equal(dirName('C:\\Projects\\cc'), 'cc');
  assert.equal(dirName('C:\\Projects\\cc\\'), 'cc');
  assert.equal(dirName('/home/me/cc'), 'cc');
});

test('banner reflects link state, then desktop UI availability', () => {
  assert.equal(bannerFor('connected', true), null);
  assert.match(bannerFor('connected', false).text, /desktop/i);
  assert.match(bannerFor('offline', true).text, /offline/i);
  assert.match(bannerFor('connecting', true).text, /connecting/i);
  assert.equal(bannerFor('kicked', true).action, 'reconnect');
  assert.equal(bannerFor('idle', true).action, 'reconnect');
});

test('status text covers every desktop status', () => {
  for (const s of ['busy', 'idle', 'needs-input', 'done', 'unseen', 'error', 'dead', 'rate-limited']) {
    assert.ok(statusText(s) && statusText(s) !== s, s);
  }
  assert.equal(statusText('something-new'), 'something-new');
});

test('spawn targets: main worktree first, then the others', () => {
  const t = spawnTargets({ dir: 'C:\\p' }, [
    { path: 'C:\\wt\\feat', branch: 'feat' },
    { path: 'C:\\p', branch: 'main', isMain: true },
  ]);
  assert.deepEqual(t, [
    { label: 'main', cwd: 'C:\\p', dir: 'C:\\p' },
    { label: 'feat', cwd: 'C:\\wt\\feat', dir: 'C:\\p' },
  ]);
});

test('spawn targets: a project with no worktree list falls back to its root', () => {
  assert.deepEqual(spawnTargets({ dir: '/p' }, []), [{ label: 'p', cwd: '/p', dir: '/p' }]);
});

test('estimateTermSize gives protocol-valid cols/rows for a phone viewport', () => {
  const { cols, rows } = estimateTermSize(390, 700, 11);
  assert.ok(Number.isInteger(cols) && cols >= 40 && cols <= 80, `cols ${cols}`);
  assert.ok(Number.isInteger(rows) && rows >= 30 && rows <= 70, `rows ${rows}`);
  const tiny = estimateTermSize(1, 1, 24);
  assert.ok(tiny.cols >= 2 && tiny.rows >= 2);
});

test('filterAgents: all, active (running) or closed (resumable)', () => {
  const list = [
    { id: 'a', dormant: false },
    { id: 'b', dormant: true },
    { id: 'c', dormant: false },
  ];
  assert.deepEqual(filterAgents(list, 'all').map((a) => a.id), ['a', 'b', 'c']);
  assert.deepEqual(filterAgents(list, 'active').map((a) => a.id), ['a', 'c']);
  assert.deepEqual(filterAgents(list, 'closed').map((a) => a.id), ['b']);
  assert.deepEqual(filterAgents(list, 'bogus').map((a) => a.id), ['a', 'b', 'c']);
});

test('agentActions mirror the desktop menus', () => {
  const ids = (a) => agentActions(a).map((x) => x.id);
  assert.deepEqual(ids({ dormant: false, isMain: true }), ['rename', 'close']);
  assert.deepEqual(ids({ dormant: false, isMain: false }), ['rename', 'deleteWorktree', 'close']);
  assert.deepEqual(ids({ dormant: true, isMain: false }), ['resume', 'forget']);
});
