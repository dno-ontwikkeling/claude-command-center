'use strict';

import { els } from './dom.js';
import { ICONS } from './icons.mjs';
import { state, agents, dormant, agentsForDir, dormantForDir, onStatusChanged } from './state.js';
import { bandModel } from './needs-band.mjs';
import { openMenu, confirmDialog } from './modals.js';
import { refreshAgentGit } from './agent-git.mjs';
import { activate, renameAgent, sleepAgent, forgetAgent, resume, reorderAgent, forceStatus, spawn } from './agents.js';
import { newAgent } from './worktree.js';
import { setDashboard } from './view.js';

// ---------------------------------------------------------------------------
// The board: agents only. Every live and sleeping agent is one row (project
// name over its branch, then a state word), grouped under Projects and
// Workspaces. Managing the projects and workspaces themselves lives on the
// dashboard (dashboard.js).
// ---------------------------------------------------------------------------

// Forget from the menu: confirm (and for a worktree, whether to delete its
// folder and branch), then forgetAgent; a git refusal offers a force remove.
async function forgetFlow(id) {
  const a = agents.get(id) || dormant.get(id);
  if (!a) return;
  // Agents saved before isMain was normalised have it undefined for worktrees.
  const worktree = !a.isMain;
  const answer = await confirmDialog(
    'Forget agent',
    'This stops the session and removes it from Command Center.' + (worktree ? '' : ' Files on disk are left untouched.'),
    { okLabel: 'Forget', danger: true, checkbox: worktree ? `Also delete the worktree folder:\n${a.cwd}` : null }
  );
  // checkbox makes confirmDialog resolve { ok, checked }; otherwise a boolean.
  const ok = typeof answer === 'object' ? answer.ok : answer;
  const deleteWorktree = typeof answer === 'object' ? answer.checked : false;
  if (!ok) return;
  const deleteBranch =
    deleteWorktree && a.branch
      ? await confirmDialog('Delete branch', `Also delete the local branch “${a.branch}”?`, { okLabel: 'Delete branch', danger: true })
      : false;
  let res = await forgetAgent(id, { deleteWorktree, deleteBranch, prompt: true });
  if (res.needsForce) {
    const force = await confirmDialog('Force remove worktree', `git refused:\n\n${res.error}\n\nForce remove? This discards uncommitted changes.`, {
      okLabel: 'Force remove',
      danger: true,
    });
    if (!force) return;
    res = await forgetAgent(id, { deleteWorktree, deleteBranch, force: true, prompt: true });
  }
  const notes = [res.error, res.cleanupError, res.branchError].filter(Boolean);
  if (notes.length) await confirmDialog('Forget agent', notes.join('\n\n'), { alert: true });
}

// A filled dot coloured per status (`st-idle`/`st-busy`/`st-needs`/`st-done`),
// mirroring the row's own status dot so the "Set status" menu shows the exact
// indicator each choice applies. Colour comes from CSS (theme-aware) via the
// class, painted through fill="currentColor".
const statusDot = (cls) =>
  `<svg class="st-dot ${cls}" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>`;

// The row's second line: custom name, else branch, else generated label.
export const rowLabel = (x) => x.customLabel || x.branch || x.label;

export function projectName(dir) {
  const p = state.projectsData.find((x) => x.dir === dir) || state.workspacesData.find((x) => x.dir === dir);
  return p ? p.name : dir.split(/[\\/]/).filter(Boolean).pop();
}

// Live name filter. Empty string shows everything. Filtering toggles row
// visibility (see applyFilter) rather than rebuilding the sidebar, so keystrokes
// never re-spawn the git subprocesses that a full render triggers.
let filterText = '';

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

// Shared skeleton: signal square, project name over the label, state word, ⋮.
// The state word's text comes from CSS keyed on the square's class, so it
// follows setStatus without a re-render.
function rowShell(id, x, dotClass) {
  const row = document.createElement('li');
  row.className = 'agent';
  row.dataset.id = id;
  if (id === state.activeId) row.classList.add('active');

  const dot = document.createElement('span');
  dot.className = `dot ${dotClass}`;

  const text = document.createElement('span');
  text.className = 'agent-text';
  text.title = x.cwd;
  const title = document.createElement('span');
  title.className = 'agent-title';
  title.textContent = projectName(x.dir);
  const sub = document.createElement('span');
  sub.className = 'agent-sub';
  sub.textContent = rowLabel(x);
  text.append(title, sub);
  row.dataset.name = `${title.textContent} ${sub.textContent}`.toLowerCase();

  const word = document.createElement('span');
  word.className = 'agent-state';

  const kebab = document.createElement('button');
  kebab.className = 'kebab';
  kebab.innerHTML = ICONS.kebab;

  row.append(dot, text, word, kebab);
  return { row, dot, sub, kebab };
}

function buildAgentRow(id, a) {
  const { row, dot, sub, kebab } = rowShell(id, a, a.status);
  a.dotEl = dot;
  a.labelEl = sub; // refreshAgentGit updates the branch label in place
  kebab.title = 'Agent options';

  // Lazily populate the git cache the first time this agent's row is built (a
  // new spawn). Existing agents already have `_gitFetched`, so later renders
  // don't re-hit git here.
  if (!a._gitFetched) refreshAgentGit(id, a);

  // Drag to reorder within the same project/workspace.
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const dragged = e.dataTransfer.getData('text/plain');
    if (dragged && dragged !== id) reorderAgent(dragged, id);
  });

  row.addEventListener('click', (e) => {
    if (e.target === kebab) return;
    activate(id);
  });
  // Double-click the label to rename (same flow as the kebab "Rename").
  sub.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    renameAgent(id);
  });
  kebab.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu(kebab, [
      { label: 'Rename', icon: ICONS.pencil, action: () => renameAgent(id) },
      { label: 'Sleep', icon: ICONS.moon, action: () => sleepAgent(id) },
      {
        label: 'Set status',
        icon: ICONS.activity,
        submenu: [
          { label: 'Idle', icon: statusDot('st-idle'), action: () => forceStatus(id, 'idle') },
          { label: 'Busy', icon: statusDot('st-busy'), action: () => forceStatus(id, 'busy') },
          { label: 'Needs input', icon: statusDot('st-needs'), action: () => forceStatus(id, 'needs-input') },
          { label: 'Done', icon: statusDot('st-done'), action: () => forceStatus(id, 'done') },
        ],
      },
      { label: 'Forget', icon: ICONS.xCircle, danger: true, action: () => forgetFlow(id) },
    ]);
  });

  return row;
}

function buildDormantRow(id, d) {
  const { row, kebab } = rowShell(id, d, 'dormant');
  row.classList.add('dormant');
  row.title = 'Resume this session';
  kebab.title = 'Session options';

  row.addEventListener('click', (e) => {
    if (e.target === kebab) return;
    resume(id);
  });
  kebab.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu(kebab, [
      { label: 'Rename', icon: ICONS.pencil, action: () => renameAgent(id) },
      { label: 'Resume', icon: ICONS.play, action: () => resume(id) },
      { label: 'Forget', icon: ICONS.xCircle, danger: true, action: () => forgetFlow(id) },
    ]);
  });

  return row;
}

// ---------------------------------------------------------------------------
// Agent filter: all | active (running) | sleeping (tracked, not running).
// Persisted, same choices as the phone app.
// ---------------------------------------------------------------------------

const AGENT_FILTER_KEY = 'agentFilter';
let agentFilter = (() => {
  try {
    return localStorage.getItem(AGENT_FILTER_KEY) || 'all';
  } catch {
    return 'all';
  }
})();
function syncFilterButtons() {
  const buttons = [...els.agentFilter.querySelectorAll('button')];
  buttons.forEach((b, i) => {
    const on = b.dataset.filter === agentFilter;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
    if (on) els.agentFilter.dataset.i = String(i); // positions the pill (CSS)
  });
}
els.agentFilter.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-filter]');
  if (!b) return;
  agentFilter = b.dataset.filter;
  try {
    localStorage.setItem(AGENT_FILTER_KEY, agentFilter);
  } catch {
    /* private mode: keep it for this session */
  }
  syncFilterButtons();
  renderSidebar();
});
syncFilterButtons();
// Arm the pill's slide only once the saved choice has been painted in place.
requestAnimationFrame(() => requestAnimationFrame(() => els.agentFilter.classList.add('animated')));

// Rows for the given dirs, in dir order then agent order, per the filter.
function rowsFor(dirs) {
  const rows = [];
  for (const dir of dirs) {
    if (agentFilter !== 'sleeping') for (const [id, a] of agentsForDir(dir)) rows.push(buildAgentRow(id, a));
    if (agentFilter !== 'active') for (const [id, d] of dormantForDir(dir)) rows.push(buildDormantRow(id, d));
  }
  return rows;
}

function emptyRow(text) {
  const li = document.createElement('li');
  li.className = 'list-empty';
  li.textContent = text;
  return li;
}

const EMPTY_TEXT = { all: 'No agents', active: 'No running agents', sleeping: 'No sleeping agents' };

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderSidebar() {
  const projectDirs = state.projectsData.map((p) => p.dir);
  const wsDirs = state.workspacesData.map((w) => w.dir);
  // An agent whose folder is no longer listed (forgotten while running) still
  // gets a row under Projects, so nothing live goes missing.
  const known = new Set([...projectDirs, ...wsDirs]);
  const orphanDirs = [...new Set([...agents.values(), ...dormant.values()].map((a) => a.dir))].filter((d) => !known.has(d));

  const p = rowsFor([...projectDirs, ...orphanDirs]);
  els.list.replaceChildren(...(p.length ? p : [emptyRow(EMPTY_TEXT[agentFilter])]));
  const w = rowsFor(wsDirs);
  els.wsList.replaceChildren(...(w.length ? w : [emptyRow(EMPTY_TEXT[agentFilter])]));

  applyFilter();
  renderBand();
  requestAnimationFrame(updateBelowMarker);
}

// Toggle each row's visibility against the name filter. Cheap DOM-only pass
// (no data rebuild, no git spawns), so it's safe to run on every keystroke.
function applyFilter() {
  for (const row of [...els.list.querySelectorAll('.agent'), ...els.wsList.querySelectorAll('.agent')]) {
    row.hidden = filterText ? !row.dataset.name.includes(filterText) : false;
  }
}

// ---------------------------------------------------------------------------
// "Needs you" band: every agent blocked on you, oldest first, above the list
// (their rows hide themselves). It ignores the name filter and All / Active /
// Sleeping on purpose, so a waiting agent can never be filtered out of sight.
// ---------------------------------------------------------------------------

// "Claude needs your permission to use Bash" -> "Permission to use Bash".
const askText = (message) => (message ? message.replace(/^claude needs your permission/i, 'Permission') : 'Waiting for your input');

function renderBand() {
  const { items, more } = bandModel(agents, projectName);
  const band = els.needsBand;
  band.hidden = !items.length;
  band.replaceChildren();
  if (!items.length) return;

  const head = document.createElement('div');
  head.className = 'nb-head';
  head.textContent = 'Needs you';
  band.append(head);

  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'nb-item';
    b.title = 'Open this agent';
    const label = document.createElement('span');
    label.className = 'nb-label';
    label.textContent = it.label;
    const meta = document.createElement('span');
    meta.className = 'nb-meta';
    meta.textContent = `${it.project} · ${askText(it.message)}`;
    b.append(label, meta);
    b.addEventListener('click', () => activate(it.id));
    band.append(b);
  }
  if (more) {
    const m = document.createElement('div');
    m.className = 'nb-more';
    m.textContent = `+${more} more waiting`;
    band.append(m);
  }
}

// ---------------------------------------------------------------------------
// Loud rows below the fold: on a short window the list scrolls, and a finished,
// error or rate-limited row out of view would be silent. A marker on the list's
// bottom edge names what is down there; clicking it scrolls to the first one.
// ---------------------------------------------------------------------------

const LOUD = [
  ['error', 'error'],
  ['rate-limited', 'rate limited'],
  ['unseen', 'finished'],
];
const belowMarker = document.createElement('button');
belowMarker.className = 'below-marker';
belowMarker.hidden = true;
els.list.closest('#lists').after(belowMarker);

function updateBelowMarker() {
  const lists = els.list.closest('#lists');
  const edge = lists.getBoundingClientRect().bottom;
  const below = [...lists.querySelectorAll('.agent')].filter((row) => row.offsetParent && row.getBoundingClientRect().bottom > edge + 1);
  const counts = LOUD.map(([cls, word]) => [word, below.filter((r) => r.querySelector(`.dot.${cls}`)).length]).filter(([, n]) => n);
  belowMarker.hidden = !counts.length;
  if (!counts.length) return;
  belowMarker.textContent = `${counts.map(([w, n]) => `${n} ${w}`).join(' · ')} below`;
  belowMarker.onclick = () => {
    const first = below.find((r) => LOUD.some(([cls]) => r.querySelector(`.dot.${cls}`)));
    first?.scrollIntoView({ block: 'nearest' });
  };
}
els.list.closest('#lists').addEventListener('scroll', updateBelowMarker, { passive: true });
window.addEventListener('resize', updateBelowMarker);

onStatusChanged(() => {
  renderBand();
  updateBelowMarker();
});

// ---------------------------------------------------------------------------
// Section "+": start an agent in one of the listed projects / workspaces. The
// lists themselves are managed on the dashboard, which the menu links to.
// ---------------------------------------------------------------------------

function openNewAgentMenu(anchor, kind) {
  const isWs = kind === 'workspace';
  const list = isWs ? state.workspacesData : state.projectsData;
  const items = list.map((x) => ({
    label: x.name,
    icon: isWs ? ICONS.folder : ICONS.branch,
    action: () => (isWs ? spawn(x.dir, x.dir, null, true) : newAgent(x)),
  }));
  items.push({
    label: isWs ? 'Manage workspaces' : 'Manage projects',
    icon: ICONS.gear,
    action: () => setDashboard(true),
  });
  openMenu(anchor, items);
}

els.newProjectAgent.addEventListener('click', (e) => {
  e.stopPropagation();
  openNewAgentMenu(els.newProjectAgent, 'project');
});
els.newWsAgent.addEventListener('click', (e) => {
  e.stopPropagation();
  openNewAgentMenu(els.newWsAgent, 'workspace');
});

// ---------------------------------------------------------------------------
// Name filter field
// ---------------------------------------------------------------------------

// Debounce the filter so a fast typist doesn't fire an applyFilter per keystroke.
let filterTimer = null;
els.sidebarFilter.addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    filterText = els.sidebarFilter.value.trim().toLowerCase();
    applyFilter();
  }, 200);
});
// Esc clears the filter while the box is focused (immediate, no debounce);
// a second Esc on an empty box folds it away again.
els.sidebarFilter.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (filterText) {
    clearTimeout(filterTimer);
    els.sidebarFilter.value = '';
    filterText = '';
    applyFilter();
  } else {
    showFilter(false);
  }
});

// The filter field is folded behind the header's search button until needed.
const filterBox = els.sidebarFilter.closest('.sidebar-search');
function showFilter(open) {
  filterBox.hidden = !open;
  els.filterToggle.setAttribute('aria-expanded', String(open));
  els.filterToggle.classList.toggle('on', open);
  if (open) els.sidebarFilter.focus();
}
els.filterToggle.addEventListener('click', () => showFilter(filterBox.hidden));
