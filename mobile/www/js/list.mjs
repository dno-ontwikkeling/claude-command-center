// Agent list: live + dormant agents grouped by project, status dots, Resume /
// Close, and a "New agent" sheet (project/workspace -> worktree -> spawn).
import { ctx, screens, show, onChanged } from './core.mjs';
import {
  groupAgents,
  bannerFor,
  spawnTargets,
  estimateTermSize,
  statusLabel,
  filterAgents,
  agentActions,
  dirName,
  FILTERS,
} from './list-model.mjs';
import { browseFolders } from './folders.mjs';
import { h, fill, NO_SUGGESTIONS } from './dom.mjs';
import { alertDialog, confirmDialog, promptDialog } from './dialog.mjs';

const FILTER_KEY = 'cc.listFilter';
function loadFilter() {
  try {
    const f = localStorage.getItem(FILTER_KEY) || 'all';
    return f === 'closed' ? 'sleeping' : f; // renamed in 1.9
  } catch {
    return 'all';
  }
}
function saveFilter(f) {
  try {
    localStorage.setItem(FILTER_KEY, f);
  } catch {
    /* private mode: keep it for this session only */
  }
}

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
    alertDialog(errText(err));
  } finally {
    btn.disabled = false;
  }
}

// Tapping an agent opens it; a sleeping one is resumed first (same as the
// desktop sidebar).
async function openAgent(a) {
  if (!a.dormant) return openTerminal(a.id);
  const { id } = await ctx.rpc.call('resume', { id: a.id, ...phoneSize() });
  openTerminal(id);
}

function agentRow(a) {
  const row = h(
    'li',
    { class: `agent status-${a.status}${a.dormant ? ' sleeping' : ''}` },
    h('span', { class: `dot ${a.dormant ? 'dormant' : a.status}` }),
    h('span', { class: 'label' }, a.label),
    h('span', { class: 'status' }, statusLabel(a)),
  );
  let busy = false;
  row.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      await openAgent(a);
    } catch (err) {
      alertDialog(errText(err));
    } finally {
      busy = false;
    }
  });
  const more = h('button', { class: 'small more', 'aria-label': 'More actions' }, '⋮');
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    openActionsSheet(document.getElementById('app'), a);
  });
  row.append(more);
  return row;
}

// ---- row actions (same as the desktop sidebar's kebab menus) -----------------

function openSheet(el) {
  const sheet = h('div', { class: 'sheet' });
  const backdrop = h('div', { class: 'backdrop', onclick: (e) => e.target === backdrop && backdrop.remove() }, sheet);
  el.append(backdrop);
  return { sheet, close: () => backdrop.remove() };
}

const errText = (err) => (err && err.message) || String(err);

// Forget: stop + stop tracking. A worktree's folder (and branch) can go too;
// the PC stops the session and waits for it to exit before deleting anything.
async function forgetFlow(a) {
  const worktree = a.isMain === false;
  const ok = await confirmDialog('This stops the session and removes it from Command Center.', {
    title: `Forget "${a.label}"?`,
    confirmLabel: 'Forget',
    danger: true,
  });
  if (!ok) return;
  const deleteWorktree = worktree
    ? await confirmDialog(a.cwd, { title: 'Also delete the worktree folder?', confirmLabel: 'Delete', danger: true })
    : false;
  const deleteBranch =
    deleteWorktree && a.branch
      ? await confirmDialog(a.branch, { title: 'Also delete the local branch?', confirmLabel: 'Delete', danger: true })
      : false;
  let res = await ctx.rpc.call('agent.forget', { id: a.id, deleteWorktree, deleteBranch, force: false });
  if (res.needsForce) {
    const force = await confirmDialog(`${res.error}\n\nForce remove? This discards uncommitted changes.`, {
      title: 'git refused',
      confirmLabel: 'Force remove',
      danger: true,
    });
    if (!force) return;
    res = await ctx.rpc.call('agent.forget', { id: a.id, deleteWorktree, deleteBranch, force: true });
  }
  const notes = [res.error, res.cleanupError, res.branchError].filter(Boolean);
  if (notes.length) await alertDialog(notes.join('\n\n'));
}

const ACTIONS = {
  rename: async (a) => {
    const name = await promptDialog('Rename agent', a.label, { confirmLabel: 'Rename' });
    if (name === null || !name.trim()) return;
    await ctx.rpc.call('agent.rename', { id: a.id, name: name.trim().slice(0, 80) });
  },
  // Sleep = the desktop's Sleep: stop, keep tracking (shows as Sleeping).
  sleep: (a) => ctx.rpc.call('kill', { id: a.id }),
  resume: openAgent,
  forget: forgetFlow,
};

function openActionsSheet(el, a) {
  const { sheet, close } = openSheet(el);
  fill(
    sheet,
    h('h2', {}, a.label),
    h('p', { class: 'muted folder-path' }, a.cwd),
    h(
      'ul',
      { class: 'pick' },
      agentActions(a).map((act) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              class: act.danger ? 'danger' : null,
              onclick: async () => {
                close();
                try {
                  await ACTIONS[act.id](a);
                } catch (err) {
                  alertDialog(errText(err));
                }
              },
            },
            act.label,
          ),
        ),
      ),
    ),
  );
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

    const addProject = async () => {
      const dir = await browseFolders(sheet, { title: 'Add project', actionLabel: 'Add this folder' });
      if (!dir) return backdrop.remove();
      try {
        await ctx.rpc.call('project.add', { dir });
        backdrop.remove();
        openNewAgentSheet(el); // the new project is in the list now
      } catch (err) {
        alertDialog(errText(err));
      }
    };

    const newWorkspace = async () => {
      const parent = await browseFolders(sheet, { title: 'New workspace', actionLabel: 'Choose this folder' });
      if (!parent) return backdrop.remove();
      const name = h('input', { type: 'text', value: dirName(parent), ...NO_SUGGESTIONS });
      const asIs = h('input', { type: 'checkbox' });
      const create = h('button', { class: 'primary' }, 'Create and start agent');
      create.addEventListener('click', () =>
        run(create, async () => {
          const ws = await ctx.rpc.call('workspace.create', {
            parent,
            name: name.value.trim() || dirName(parent),
            useParent: asIs.checked,
          });
          // Same as the desktop: start an agent in the new workspace.
          await spawn(create, { dir: ws.dir, cwd: ws.dir });
        }),
      );
      fill(
        sheet,
        h('h2', {}, 'New workspace'),
        h('p', { class: 'muted folder-path' }, parent),
        h('label', { class: 'field' }, h('span', {}, 'Name'), name),
        h('label', { class: 'field' }, h('span', {}, 'Use this folder as-is (no subfolder)'), asIs),
        h('div', { class: 'row' }, h('button', { onclick: () => backdrop.remove() }, 'Cancel'), create),
      );
    };

    pick('New agent', [
      ...projects.map((p) => h('li', {}, h('button', { onclick: () => chooseWorktree(p) }, p.name))),
      ...workspaces.map((w) => {
        const b = h('button', {}, `${w.name} (workspace)`);
        b.addEventListener('click', () => spawn(b, { dir: w.dir, cwd: w.dir }));
        return h('li', {}, b);
      }),
      h('li', { class: 'pick-extra' }, h('button', { onclick: addProject }, '+ Add project')),
      h('li', {}, h('button', { onclick: newWorkspace }, '+ New workspace')),
    ]);
  } catch (err) {
    sheet.replaceChildren(h('p', { class: 'warn' }, (err && err.message) || String(err)));
  }
}

// ---- screen ---------------------------------------------------------------

screens.list = (el) => {
  // The list draws into its own container: sheets (New agent, row menu) live
  // next to it in `el`, so a redraw on a status change doesn't close them.
  const body = h('div');
  el.append(body);
  let filter = loadFilter();
  let drawn = null; // what's on screen, to skip redraws that change nothing
  const setFilter = (f) => {
    filter = f;
    saveFilter(f);
    render();
  };
  const render = () => {
    const banner = bannerFor(ctx.linkState, ctx.agents.desktopUi);
    const visible = filterAgents(ctx.agents.list, filter);
    const connected = ctx.linkState === 'connected';
    // Redrawing replaces the rows, which eats a tap that lands mid-redraw.
    const sig = JSON.stringify([banner, visible, filter, connected, ctx.agents.desktopUi]);
    if (sig === drawn) return;
    drawn = sig;
    const groups = groupAgents(visible);
    fill(body,
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
      h(
        'div',
        { class: 'filters', role: 'tablist' },
        FILTERS.map((f) =>
          h(
            'button',
            { class: `chip${f.id === filter ? ' on' : ''}`, role: 'tab', 'aria-selected': String(f.id === filter), onclick: () => setFilter(f.id) },
            f.label,
          ),
        ),
      ),
      groups.length
        ? groups.map((g) =>
            h(
              'section',
              { class: 'group' },
              h('h2', {}, g.name),
              h('ul', { class: 'agents' }, g.live.map(agentRow), g.dormant.map(agentRow)),
            ),
          )
        : h('p', { class: 'muted' }, connected ? (filter === 'all' ? 'No agents yet.' : `No ${filter} agents.`) : ''),
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
