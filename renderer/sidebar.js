'use strict';

import { els } from './dom.js';
import { ICONS } from './icons.mjs';
import { state, agents, dormant, agentsForDir, dormantForDir, readLocalJson, onStatusChanged } from './state.js';
import { bandModel } from './needs-band.mjs';
import { openMenu, promptText, confirmDialog } from './modals.js';
import { refreshAgentGit } from './agent-git.mjs';
import { activate, killAndWait, removeAgent, renameAgent, sleepAgent, forgetAgent, resume, pruneDormantForDir, reorderAgent, forceStatus, spawn } from './agents.js';
import { newAgent } from './worktree.js';

// ---------------------------------------------------------------------------
// Projects + Workspaces sidebar
//
// Projects are git repos: clicking launches a worktree via the picker.
// Workspaces are plain scratch folders: clicking launches an agent straight in
// the folder, no git. Both host the same agent/dormant rows, built by the
// shared helpers below.
// ---------------------------------------------------------------------------

// Short badge per detected project type (see detectProjectType in main.js).

// Forget from the menu: confirm (and for a worktree, whether to delete its
// folder and branch), then forgetAgent; a git refusal offers a force remove.
async function forgetFlow(id) {
  const a = agents.get(id) || dormant.get(id);
  if (!a) return;
  const worktree = a.isMain === false;
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

// Collapsed items (by dir) — persisted so the tree state survives a restart.
// Shared across projects and workspaces (dirs are unique).
const COLLAPSED_KEY = 'collapsedProjects';
const collapsed = new Set(readLocalJson(COLLAPSED_KEY, []));

function toggleCollapse(dir) {
  if (collapsed.has(dir)) collapsed.delete(dir);
  else collapsed.add(dir);
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  renderSidebar();
}

function saveCollapsed() {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
}

// Collapse-all / expand-all toggle: if anything is open, collapse everything;
// otherwise expand everything. Operates on both projects and workspaces.
function toggleCollapseAll() {
  const dirs = [
    ...state.projectsData.map((p) => p.dir),
    ...state.workspacesData.map((w) => w.dir),
  ];
  const anyOpen = dirs.some((d) => !collapsed.has(d));
  collapsed.clear();
  if (anyOpen) for (const d of dirs) collapsed.add(d);
  saveCollapsed();
  renderSidebar();
}

// Board row label: custom name, else branch, else generated label. No branch
// glyph, so branch and custom labels share one left edge.
export const rowLabel = (x) => x.customLabel || x.branch || x.label;

// Live name filter. Empty string shows everything. Filtering toggles row
// visibility (see applyFilter) rather than rebuilding the sidebar, so keystrokes
// never re-spawn the git subprocesses that a full render triggers.
let filterText = '';

// ---------------------------------------------------------------------------
// Shared row builders (used by both projects and workspaces)
// ---------------------------------------------------------------------------

function buildAgentRow(id, a) {
  const row = document.createElement('li');
  row.className = 'agent';
  row.dataset.id = id;
  if (id === state.activeId) row.classList.add('active');

  const dot = document.createElement('span');
  dot.className = `dot ${a.status}`;
  a.dotEl = dot;

  const label = document.createElement('span');
  label.className = 'agent-label';
  label.textContent = rowLabel(a);
  label.title = a.cwd;
  a.labelEl = label; // refreshAgentGit updates the branch label in place

  // Short state word ("finished", "error", "rate limited"). Empty for the
  // calm states; the text comes from CSS keyed on the dot's class, so it
  // follows setStatus without a re-render. The diff stat lives in the stage
  // pass strip for the active agent only.
  const word = document.createElement('span');
  word.className = 'agent-state';

  // Lazily populate the git cache the first time this agent's row is built (a
  // new spawn). Existing agents already have `_gitFetched`, so later renders
  // triggered by collapse/reorder/refresh don't re-hit git here.
  if (!a._gitFetched) refreshAgentGit(id, a);

  const rowKebab = document.createElement('button');
  rowKebab.className = 'kebab';
  rowKebab.innerHTML = ICONS.kebab;
  rowKebab.title = 'Agent options';

  row.append(dot, label, word, rowKebab);

  // Drag to reorder within the project/workspace.
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
    if (e.target === rowKebab) return;
    activate(id);
  });
  // Double-click the label to rename (same flow as the kebab "Rename").
  label.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    renameAgent(id);
  });
  rowKebab.addEventListener('click', (e) => {
    e.stopPropagation();
    const items = [
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
    ];
    items.push({ label: 'Forget', icon: ICONS.xCircle, danger: true, action: () => forgetFlow(id) });
    openMenu(rowKebab, items);
  });

  return row;
}

function buildDormantRow(id, d) {
  const row = document.createElement('li');
  row.className = 'agent dormant';
  row.dataset.id = id;
  row.title = 'Resume this session';

  const dot = document.createElement('span');
  dot.className = 'dot dormant';

  const label = document.createElement('span');
  label.className = 'agent-label';
  label.textContent = rowLabel(d);
  label.title = d.cwd;

  const rowKebab = document.createElement('button');
  rowKebab.className = 'kebab';
  rowKebab.innerHTML = ICONS.kebab;
  rowKebab.title = 'Session options';

  const word = document.createElement('span');
  word.className = 'agent-state';

  row.append(dot, label, word, rowKebab);

  row.addEventListener('click', (e) => {
    if (e.target === rowKebab) return;
    resume(id);
  });
  rowKebab.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu(rowKebab, [
      { label: 'Rename', icon: ICONS.pencil, action: () => renameAgent(id) },
      { label: 'Resume', icon: ICONS.play, action: () => resume(id) },
      { label: 'Forget', icon: ICONS.xCircle, danger: true, action: () => forgetFlow(id) },
    ]);
  });

  return row;
}

// Agent filter: all | active (running) | sleeping (tracked, not running).
// Persisted, same choices as the phone app.
const AGENT_FILTER_KEY = 'agentFilter';
let agentFilter = (() => {
  try {
    return localStorage.getItem(AGENT_FILTER_KEY) || 'all';
  } catch {
    return 'all';
  }
})();
function syncFilterButtons() {
  for (const b of els.agentFilter.querySelectorAll('button')) {
    const on = b.dataset.filter === agentFilter;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
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

// Append every agent + dormant row for `dir` (per the filter) into a fresh <ul>.
function buildAgentList(dir) {
  const sub = document.createElement('ul');
  sub.className = 'agents';
  if (agentFilter !== 'sleeping') for (const [id, a] of agentsForDir(dir)) sub.appendChild(buildAgentRow(id, a));
  if (agentFilter !== 'active') for (const [id, d] of dormantForDir(dir)) sub.appendChild(buildDormantRow(id, d));
  return sub;
}

// Common item header (chevron + type icon + name + collapse count + add + kebab).
// A plain header click toggles collapse; `onAddAgent` fires from the + button;
// `menuItems` builds the kebab menu.
function buildItemHeader(p, { dragType, onReorder, onAddAgent, menuItems }) {
  const item = document.createElement('li');
  item.className = 'project-item';
  // Stashed for applyFilter so it can toggle visibility without a rebuild.
  item.dataset.name = p.name.toLowerCase();

  const isCollapsed = collapsed.has(p.dir);
  if (isCollapsed) item.classList.add('collapsed');

  const header = document.createElement('div');
  header.className = 'project';
  header.dataset.dir = p.dir;

  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.innerHTML = isCollapsed ? ICONS.chevronRight : ICONS.chevronDown;
  chevron.title = isCollapsed ? 'Expand' : 'Collapse';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = p.name;
  name.title = p.dir;

  const addBtn = document.createElement('button');
  addBtn.className = 'add-agent';
  addBtn.innerHTML = `${ICONS.plus}<span>New agent</span>`;
  addBtn.title = 'New agent';

  const kebab = document.createElement('button');
  kebab.className = 'kebab';
  kebab.innerHTML = ICONS.kebab;
  kebab.title = 'Options';

  header.append(chevron, name);

  // Collapsed: one tiny signal square per agent, so a problem inside a folded
  // project still shows. The squares are the agents' own dot class names.
  const rows = [...agentsForDir(p.dir).map(([, a]) => a.status), ...dormantForDir(p.dir).map(() => 'dormant')];
  if (isCollapsed && rows.length) {
    const mini = document.createElement('span');
    mini.className = 'mini';
    mini.title = `${rows.length} hidden`;
    for (const st of rows) {
      const sq = document.createElement('i');
      sq.className = `dot ${st}`;
      mini.append(sq);
    }
    header.append(mini);
  }
  header.append(addBtn, kebab);
  item.appendChild(header);

  // Drag the header to reorder within its own section (distinct dataTransfer
  // type keeps projects, workspaces and agent rows from cross-dropping).
  header.draggable = true;
  header.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(dragType, p.dir);
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('dragging');
    e.stopPropagation();
  });
  header.addEventListener('dragend', () => item.classList.remove('dragging'));
  item.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes(dragType)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  item.addEventListener('drop', (e) => {
    const dragged = e.dataTransfer.getData(dragType);
    if (!dragged || dragged === p.dir) return;
    e.preventDefault();
    onReorder(dragged, p.dir);
  });

  // Plain header click toggles collapse (no longer opens/spawns anything).
  // The chevron falls through to here; addBtn/kebab stopPropagation in their
  // own handlers, so this never fires for them.
  header.addEventListener('click', () => toggleCollapse(p.dir));
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onAddAgent();
  });
  kebab.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu(kebab, menuItems());
  });

  return item;
}

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

async function reorderProject(draggedDir, targetDir) {
  const dirs = state.projectsData.map((p) => p.dir).filter((d) => d !== draggedDir);
  const at = dirs.indexOf(targetDir);
  if (at < 0) return;
  dirs.splice(at, 0, draggedDir);
  state.projectsData = await window.api.reorderProjects(dirs);
  renderSidebar();
}

async function reorderWorkspace(draggedDir, targetDir) {
  const dirs = state.workspacesData.map((w) => w.dir).filter((d) => d !== draggedDir);
  const at = dirs.indexOf(targetDir);
  if (at < 0) return;
  dirs.splice(at, 0, draggedDir);
  state.workspacesData = await window.api.reorderWorkspaces(dirs);
  renderSidebar();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderSidebar() {
  renderProjects();
  renderWorkspaces();
  applyFilter();
  renderBand();
  requestAnimationFrame(updateBelowMarker);
}

// ---------------------------------------------------------------------------
// "Needs you" band: every agent blocked on you, oldest first, above the list
// (their rows hide themselves). It ignores the name filter and All / Active /
// Sleeping on purpose, so a waiting agent can never be filtered out of sight.
// ---------------------------------------------------------------------------

function projectName(dir) {
  const p = state.projectsData.find((x) => x.dir === dir) || state.workspacesData.find((x) => x.dir === dir);
  return p ? p.name : null;
}

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

// Collapsed headings carry one square per agent; keep them in step with live
// status changes without a full re-render.
function refreshMinis() {
  for (const item of [...els.list.children, ...els.wsList.children]) {
    const mini = item.querySelector(':scope > .project > .mini');
    if (!mini) continue;
    const dir = item.querySelector(':scope > .project').dataset.dir;
    const states = [...agentsForDir(dir).map(([, a]) => a.status), ...dormantForDir(dir).map(() => 'dormant')];
    mini.replaceChildren(
      ...states.map((st) => {
        const sq = document.createElement('i');
        sq.className = `dot ${st}`;
        return sq;
      })
    );
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
  refreshMinis();
  updateBelowMarker();
});

// Toggle each item's visibility against the current filter. Cheap DOM-only pass
// (no data rebuild, no git spawns), so it's safe to run on every keystroke.
function applyFilter() {
  for (const item of [...els.list.children, ...els.wsList.children]) {
    const name = item.dataset.name || '';
    item.hidden = filterText ? !name.includes(filterText) : false;
  }
}

function renderProjects() {
  els.list.innerHTML = '';
  for (const p of state.projectsData) {
    const addAgent = () => newAgent(p);
    const item = buildItemHeader(p, {
      dragType: 'application/x-cc-project',
      onReorder: reorderProject,
      onAddAgent: addAgent,
      menuItems: () => [
        { label: 'Open worktree', icon: ICONS.branch, action: addAgent },
        { label: 'Forget project', icon: ICONS.minusCircle, danger: true, action: () => removeProject(p.dir) },
      ],
    });
    item.appendChild(buildAgentList(p.dir));
    els.list.appendChild(item);
  }
}

function renderWorkspaces() {
  els.wsList.innerHTML = '';
  for (const w of state.workspacesData) {
    const addAgent = () => spawn(w.dir, w.dir, null, true);
    const item = buildItemHeader(w, {
      dragType: 'application/x-cc-workspace',
      onReorder: reorderWorkspace,
      onAddAgent: addAgent,
      menuItems: () => [
        { label: 'New agent', icon: ICONS.plus, action: addAgent },
        { label: 'Open in Explorer', icon: ICONS.folder, action: () => window.api.openInExplorer(w.dir) },
        { label: 'Forget workspace', icon: ICONS.minusCircle, danger: true, action: () => removeWorkspace(w.dir) },
      ],
    });
    item.appendChild(buildAgentList(w.dir));
    els.wsList.appendChild(item);
  }
}

// ---------------------------------------------------------------------------
// Data refresh + mutations
// ---------------------------------------------------------------------------

export async function refreshProjects() {
  const [projects, workspaces] = await Promise.all([
    window.api.listProjects(),
    window.api.listWorkspaces(),
  ]);
  state.projectsData = projects;
  state.workspacesData = workspaces;
  renderSidebar();
}

async function removeProject(dir) {
  const ok = await confirmDialog(
    'Forget project',
    'This removes the project from Command Center. The folder on disk is left untouched.',
    { okLabel: 'Forget', danger: true }
  );
  if (!ok) return;
  for (const [id] of agentsForDir(dir)) removeAgent(id, true);
  pruneDormantForDir(dir, true);
  state.projectsData = await window.api.removeProject(dir);
  if (collapsed.delete(dir)) saveCollapsed(); // don't leak a stale entry into localStorage forever
  renderSidebar();
}

async function removeWorkspace(dir) {
  const { ok, checked: deleteFolder } = await confirmDialog(
    'Forget workspace',
    'This removes the workspace from Command Center. The folder on disk is left untouched unless you choose to delete it below.',
    { okLabel: 'Forget', danger: true, checkbox: `Also delete ${dir} and all its contents (cannot be undone)` }
  );
  if (!ok) return;
  const ids = [...agentsForDir(dir)].map(([id]) => id);
  // Agents hold the folder as cwd; on Windows it can't be deleted until they exit.
  if (deleteFolder) await Promise.all(ids.map(killAndWait));
  for (const id of ids) removeAgent(id, true);
  pruneDormantForDir(dir, true);
  const res = await window.api.removeWorkspace(dir, { deleteFolder });
  state.workspacesData = res.workspaces;
  if (collapsed.delete(dir)) saveCollapsed(); // don't leak a stale entry into localStorage forever
  renderSidebar();
  if (res.error) confirmDialog('Delete folder', res.error, { alert: true });
}

async function createWorkspace() {
  // Step 1: pick a folder (existing folders welcome; the picker also offers
  // "New folder"). Step 2: name it + decide whether to use that folder as-is
  // or nest a fresh subfolder under it.
  const picked = await window.api.pickWorkspaceFolder();
  if (!picked || picked.canceled || !picked.path) return;
  const base = picked.path.split(/[/\\]/).filter(Boolean).pop() || 'workspace';
  const ans = await promptText('New workspace', 'workspace name', {
    value: base,
    checkbox: 'Use selected folder as-is (don’t create a subfolder)',
  });
  if (!ans) return;
  const res = await window.api.createWorkspace({
    parent: picked.path,
    name: ans.text,
    useParent: ans.checked,
  });
  if (res.canceled) return;
  if (res.error) {
    await confirmDialog('Workspace creation failed', res.error, { alert: true });
    return;
  }
  await refreshProjects();
  // Launch an agent in the workspace straight away.
  spawn(res.dir, res.dir, null, true);
}

els.addBtn.addEventListener('click', async () => {
  state.projectsData = await window.api.addProject();
  renderSidebar();
});

els.addWsBtn.addEventListener('click', createWorkspace);

els.collapseAllBtn.addEventListener('click', toggleCollapseAll);

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
