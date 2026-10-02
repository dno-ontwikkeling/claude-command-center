// Git screen for one agent's worktree: diff stat, a diff viewer (working
// changes or branch vs base) and Fetch / Pull.
import { ctx, screens, show } from './core.mjs';
import { parseDiff } from '../vendor/diff-parse.mjs';
import { statSummary, fileRows, opToast, limitDiff } from './git-model.mjs';
import { h, fill } from './dom.mjs';

function toast(el, { kind, text }) {
  const t = h('div', { class: `toast ${kind}` }, text);
  el.append(t);
  setTimeout(() => t.remove(), 4000);
}

function renderFile(f) {
  const body = h(
    'div',
    { class: 'hunks', hidden: true },
    f.binary
      ? h('p', { class: 'muted' }, 'Binary file')
      : f.hunks.map((hk) =>
          h(
            'div',
            { class: 'hunk' },
            h('div', { class: 'hunk-head' }, `@@ -${hk.oldNo} +${hk.newNo} @@ ${hk.header}`),
            hk.lines.map((l) => h('div', { class: `line ${l.type}` }, l.text || ' ')),
          ),
        ),
  );
  return { body };
}

screens.git = (el, { id }) => {
  const agent = ctx.agents.get(id);
  const cwd = agent?.cwd;
  let mode = 'wip';

  const stat = h('p', { class: 'muted' }, '…');
  const list = h('ul', { class: 'files' });
  const modeBtns = {
    wip: h('button', { class: 'small', onclick: () => setMode('wip') }, 'Working changes'),
    branch: h('button', { class: 'small', onclick: () => setMode('branch') }, 'Branch vs base'),
  };
  const fetchBtn = h('button', { class: 'small' }, 'Fetch');
  const pullBtn = h('button', { class: 'small' }, 'Pull');

  el.append(
    h(
      'header',
      { class: 'top' },
      h('button', { class: 'icon', 'aria-label': 'Back', onclick: () => show('terminal', { id }) }, '‹'),
      h('h1', { class: 'term-title' }, agent ? `${agent.label} — git` : 'Git'),
      h('span', { class: 'spacer' }),
    ),
    stat,
    h('div', { class: 'row' }, modeBtns.wip, modeBtns.branch, fetchBtn, pullBtn),
    list,
  );

  if (!cwd) {
    stat.textContent = 'This agent is no longer available.';
    return;
  }

  async function loadStat() {
    try {
      stat.textContent = statSummary(await ctx.rpc.call('git.diffstat', { cwd }));
    } catch (err) {
      stat.textContent = (err && err.message) || String(err);
    }
  }

  async function loadDiff() {
    for (const [m, b] of Object.entries(modeBtns)) b.classList.toggle('on', m === mode);
    list.replaceChildren(h('li', { class: 'muted' }, 'Loading diff…'));
    try {
      const res = await ctx.rpc.call('git.diff', { cwd, mode });
      if (!res.ok) {
        list.replaceChildren(h('li', { class: 'warn' }, res.error));
        return;
      }
      const { files, truncated } = limitDiff(parseDiff(res.diff));
      const byPath = new Map(files.map((f) => [f.path, f]));
      const rows = fileRows(files);
      if (!rows.length) {
        list.replaceChildren(h('li', { class: 'muted' }, mode === 'branch' ? `No changes vs ${res.base}.` : 'No changes.'));
        return;
      }
      fill(list,
        ...rows.map((r) => {
          const { body } = renderFile(byPath.get(r.path));
          const head = h(
            'button',
            { class: 'file', onclick: () => (body.hidden = !body.hidden) },
            h('span', { class: `letter ${r.status}` }, r.letter),
            h('span', { class: 'fname' }, r.name, r.folder ? h('small', {}, ` ${r.folder}`) : null),
            h('span', { class: 'counts' }, r.binary ? 'bin' : `+${r.added} −${r.removed}`),
          );
          return h('li', {}, head, body);
        }),
        truncated ? h('li', { class: 'muted' }, 'Diff truncated — open it on the PC for the rest.') : null,
      );
    } catch (err) {
      list.replaceChildren(h('li', { class: 'warn' }, (err && err.message) || String(err)));
    }
  }

  function setMode(m) {
    mode = m;
    loadDiff();
  }

  async function runOp(op, btn) {
    btn.disabled = true;
    try {
      toast(el, opToast(op, await ctx.rpc.call(op === 'pull' ? 'git.pull' : 'git.fetch', { cwd })));
      await Promise.all([loadStat(), loadDiff()]);
    } catch (err) {
      toast(el, { kind: 'error', text: (err && err.message) || String(err) });
    } finally {
      btn.disabled = false;
    }
  }
  fetchBtn.addEventListener('click', () => runOp('fetch', fetchBtn));
  pullBtn.addEventListener('click', () => runOp('pull', pullBtn));

  loadStat();
  loadDiff();
};
