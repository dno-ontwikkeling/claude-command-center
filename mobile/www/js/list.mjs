// Agent list: live + dormant agents grouped by project, status dots, Resume /
// Close, and a "New agent" sheet (project/workspace -> worktree -> spawn).
import { ctx, screens, show, onChanged } from './core.mjs';
import { groupAgents, bannerFor, statusText, spawnTargets, estimateTermSize } from './list-model.mjs';
import { h, fill } from './dom.mjs';

const FONT_SIZE_FOR_ESTIMATE = 11;

function phoneSize() {
  return estimateTermSize(window.innerWidth - 8, window.innerHeight - 96, FONT_SIZE_FOR_ESTIMATE);
}

function openTerminal(id) {
  if (screens.terminal) show('terminal', { id });
}

async function run(btn, fn) {
  btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    alert((err && err.message) || String(err));
  } finally {
    btn.disabled = false;
  }
}

function agentRow(a) {
  const row = h(
    'li',
    { class: `agent status-${a.status}`, onclick: () => !a.dormant && openTerminal(a.id) },
    h('span', { class: `dot ${a.dormant ? 'dormant' : a.status}` }),
    h('span', { class: 'label' }, a.label),
    h('span', { class: 'status' }, a.dormant ? 'Resumable' : statusText(a.status)),
  );
  if (a.dormant) {
    const resume = h('button', { class: 'small' }, 'Resume');
    resume.addEventListener('click', (e) => {
      e.stopPropagation();
      run(resume, async () => {
        const { id } = await ctx.rpc.call('resume', { id: a.id, ...phoneSize() });
        openTerminal(id);
      });
    });
    row.append(resume);
  } else {
    const close = h('button', { class: 'small danger' }, 'Close');
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      // Same as the desktop's Close: a used session stays resumable.
      if (!confirm(`Close "${a.label}"?\n\nA session that was used stays resumable.`)) return;
      run(close, () => ctx.rpc.call('kill', { id: a.id }));
    });
    row.append(close);
  }
  return row;
}

// ---- new agent sheet ----------------------------------------------------------

async function openNewAgentSheet(el) {
  const sheet = h('div', { class: 'sheet' }, h('p', { class: 'muted' }, 'Loading…'));
  const backdrop = h('div', { class: 'backdrop', onclick: (e) => e.target === backdrop && backdrop.remove() }, sheet);
  el.append(backdrop);

  const spawn = async (btn, target) =>
    run(btn, async () => {
      const { id } = await ctx.rpc.call('spawn', { dir: target.dir, cwd: target.cwd, ...phoneSize() });
      backdrop.remove();
      openTerminal(id);
    });

  try {
    const [projects, workspaces] = await Promise.all([
      ctx.rpc.call('projects.list', {}),
      ctx.rpc.call('workspaces.list', {}),
    ]);
    const pick = (title, items) => sheet.replaceChildren(h('h2', {}, title), h('ul', { class: 'pick' }, items));

    const chooseWorktree = async (project) => {
      sheet.replaceChildren(h('p', { class: 'muted' }, 'Loading worktrees…'));
      const worktrees = project.isGit ? await ctx.rpc.call('worktrees.list', { dir: project.dir }) : [];
      const targets = spawnTargets(project, worktrees);
      if (targets.length === 1) {
        sheet.replaceChildren(h('p', { class: 'muted' }, 'Starting…'));
        return spawn(sheet, targets[0]);
      }
      pick(
        project.name,
        targets.map((t) => {
          const b = h('button', {}, t.label);
          b.addEventListener('click', () => spawn(b, t));
          return h('li', {}, b);
        }),
      );
    };

    pick('New agent', [
      ...projects.map((p) => h('li', {}, h('button', { onclick: () => chooseWorktree(p) }, p.name))),
      ...workspaces.map((w) => {
        const b = h('button', {}, `${w.name} (workspace)`);
        b.addEventListener('click', () => spawn(b, { dir: w.dir, cwd: w.dir }));
        return h('li', {}, b);
      }),
    ]);
  } catch (err) {
    sheet.replaceChildren(h('p', { class: 'warn' }, (err && err.message) || String(err)));
  }
}

// ---- screen ---------------------------------------------------------------

screens.list = (el) => {
  const render = () => {
    const banner = bannerFor(ctx.linkState, ctx.agents.desktopUi);
    const groups = groupAgents(ctx.agents.list);
    const connected = ctx.linkState === 'connected';
    fill(el,
      h(
        'header',
        { class: 'top' },
        h('h1', {}, 'Agents'),
        screens.settings
          ? h('button', { class: 'icon', 'aria-label': 'Settings', onclick: () => show('settings') }, '⚙')
          : null,
      ),
      banner
        ? h(
            'div',
            { class: `banner ${banner.kind}` },
            h('span', {}, banner.text),
            banner.action === 'reconnect' ? h('button', { class: 'small', onclick: () => ctx.link.connect() }, 'Reconnect') : null,
          )
        : null,
      groups.length
        ? groups.map((g) =>
            h(
              'section',
              { class: 'group' },
              h('h2', {}, g.name),
              h('ul', { class: 'agents' }, g.live.map(agentRow), g.dormant.map(agentRow)),
            ),
          )
        : h('p', { class: 'muted' }, connected ? 'No agents yet.' : ''),
      h(
        'button',
        { class: 'primary fab', disabled: !connected || !ctx.agents.desktopUi, onclick: () => openNewAgentSheet(el) },
        '+ New agent',
      ),
    );
  };
  render();
  return onChanged(render);
};
