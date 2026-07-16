'use strict';

import { els } from './dom.js';
import { state, agents, agentsForDir, dormantForDir, displayLabel, readLocalJson } from './state.js';
import { openMenu, promptText, confirmDialog } from './modals.js';
import { activate, removeAgent, renameAgent, deleteWorktree, resume, removeDormant, reorderAgent, forceStatus, spawn } from './agents.js';
import { newAgent } from './worktree.js';

// ---------------------------------------------------------------------------
// Projects + Workspaces sidebar
//
// Projects are git repos: clicking launches a worktree via the picker.
// Workspaces are plain scratch folders: clicking launches an agent straight in
// the folder, no git. Both host the same agent/dormant rows, built by the
// shared helpers below.
// ---------------------------------------------------------------------------

// GitHub-style coloured diff: green +added, red -removed. Numbers only, so
// building the markup directly is safe.
function fmtDiff(d) {
  if (!d || (!d.added && !d.removed)) return '';
  return `<span class="add">+${d.added}</span><span class="del">-${d.removed}</span>`;
}

// Short badge per detected project type (see detectProjectType in main.js).
const PTYPE_LABEL = { node: 'JS', dotnet: '.NET', go: 'GO', rust: 'RS', python: 'PY' };

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

// Live name filter. Empty string shows everything. Filtering toggles row
// visibility (see applyFilter) rather than rebuilding the sidebar, so keystrokes
// never re-spawn the git subprocesses that a full render triggers.
let filterText = '';

// ---------------------------------------------------------------------------
// Shared row builders (used by both projects and workspaces)
// ---------------------------------------------------------------------------

function typeIcon(type) {
  if (!type) return null;
  const icon = document.createElement('span');
  icon.className = `ptype ptype-${type}`;
  icon.textContent = PTYPE_LABEL[type] || '';
  icon.title = type;
  return icon;
}

// ---------------------------------------------------------------------------
// Per-agent git cache (branch + diffstat)
//
// Fetching an agent's branch + diffstat spawns two git child processes in the
// single-threaded main process, stalling every PTY. So we cache both on the
// agent (a.branch / a.diffStat), render only from that cache, and refresh
// out-of-band: once lazily when a row first appears, then on a slow independent
// timer. `_gitBusy` dedupes concurrent fetches for the same agent.
// ---------------------------------------------------------------------------

function refreshAgentGit(id, a) {
  if (a._gitBusy) return; // in-flight fetch for this agent already; skip
  a._gitBusy = true;
  a._gitFetched = true;
  Promise.all([window.api.gitBranch(a.cwd), window.api.gitDiffStat(a.cwd)])
    .then(([b, d]) => {
      // Branch can change under us (user runs git switch in the terminal).
      if (b && b !== a.branch) {
        a.branch = b;
        if (a.labelEl && !a.customLabel) a.labelEl.textContent = `⎇ ${b}`;
      }
      if (d) {
        a.diffStat = d;
        if (a.diffEl) a.diffEl.innerHTML = fmtDiff(d);
      }
    })
    .finally(() => {
      a._gitBusy = false;
    });
}

// Independent slow timer: repopulate every live agent's git cache without
// coupling to renderSidebar(). Keeps branch labels + diff badges reasonably
// fresh while a render itself stays git-free.
export function refreshAllAgentsGit() {
  for (const [id, a] of agents) refreshAgentGit(id, a);
}
// Only poll while the window is in the foreground — a hidden/backgrounded window
// does no periodic git work. Returning to the window refreshes immediately.
setInterval(() => {
  if (document.visibilityState === 'visible') refreshAllAgentsGit();
}, 15000);
window.addEventListener('focus', refreshAllAgentsGit);

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
  label.textContent = displayLabel(a);
  label.title = a.cwd;
  a.labelEl = label; // refreshAgentGit updates the branch label in place

  // Uncommitted diff size vs HEAD, e.g. "+23/-4". Rendered from the per-agent
  // cache only — the branch label and this badge are refreshed out-of-band by
  // refreshAgentGit, never during a render, so collapse/reorder/refresh (and the
  // filter, which uses applyFilter) can't spawn 2×N git subprocesses.
  const diff = document.createElement('span');
  diff.className = 'agent-diff';
  if (a.diffStat) diff.innerHTML = fmtDiff(a.diffStat);
  a.diffEl = diff;

  // Lazily populate the git cache the first time this agent's row is built (a
  // new spawn). Existing agents already have `_gitFetched`, so later renders
  // triggered by collapse/reorder/refresh don't re-hit git here.
  if (!a._gitFetched) refreshAgentGit(id, a);

  const rowKebab = document.createElement('button');
  rowKebab.className = 'kebab';
  rowKebab.textContent = '⋮';
  rowKebab.title = 'Agent options';

  row.append(dot, label, diff, rowKebab);

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
      { label: 'Rename', action: () => renameAgent(id) },
      {
        label: 'Set status ▸',
        submenu: [
          { label: 'Idle', action: () => forceStatus(id, 'idle') },
          { label: 'Busy', action: () => forceStatus(id, 'busy') },
          { label: 'Needs input', action: () => forceStatus(id, 'needs-input') },
          { label: 'Done', action: () => forceStatus(id, 'done') },
        ],
      },
    ];
    // Only worktrees have a folder of their own to delete; the main worktree and
    // workspace agents (isMain) share the folder, so offer plain close only.
    if (!a.isMain) {
      items.push({ label: 'Delete worktree', danger: true, action: () => deleteWorktree(id) });
    }
    items.push({ label: 'Close', danger: true, action: () => removeAgent(id) });
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
  label.textContent = displayLabel(d);
  label.title = d.cwd;

  const rowKebab = document.createElement('button');
  rowKebab.className = 'kebab';
  rowKebab.textContent = '⋮';
  rowKebab.title = 'Session options';

  row.append(dot, label, rowKebab);

  row.addEventListener('click', (e) => {
    if (e.target === rowKebab) return;
    resume(id);
  });
  rowKebab.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu(rowKebab, [
      { label: 'Resume', action: () => resume(id) },
      { label: 'Forget session', danger: true, action: () => removeDormant(id) },
    ]);
  });

  return row;
}

// Append every agent + dormant row for `dir` into a fresh <ul>.
function buildAgentList(dir) {
  const sub = document.createElement('ul');
  sub.className = 'agents';
  for (const [id, a] of agentsForDir(dir)) sub.appendChild(buildAgentRow(id, a));
  for (const [id, d] of dormantForDir(dir)) sub.appendChild(buildDormantRow(id, d));
  return sub;
}

// Common item header (chevron + type icon + name + collapse count + kebab).
// `onOpen` fires on a plain header click; `menuItems` builds the kebab menu.
function buildItemHeader(p, { dragType, onReorder, onOpen, menuItems }) {
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
  chevron.textContent = isCollapsed ? '▸' : '▾';
  chevron.title = isCollapsed ? 'Expand' : 'Collapse';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = p.name;
  name.title = p.dir;

  const kebab = document.createElement('button');
  kebab.className = 'kebab';
  kebab.textContent = '⋮';
  kebab.title = 'Options';

  const before = [chevron];
  const icon = typeIcon(p.type);
  if (icon) before.push(icon);
  header.append(...before, name);

  // When collapsed, show how many rows are hidden so the row isn't blank.
  const hiddenCount = agentsForDir(p.dir).length + dormantForDir(p.dir).length;
  if (isCollapsed && hiddenCount) {
    const count = document.createElement('span');
    count.className = 'collapse-count';
    count.textContent = String(hiddenCount);
    count.title = `${hiddenCount} hidden`;
    header.append(count);
  }
  header.append(kebab);
  item.appendChild(header);

  chevron.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCollapse(p.dir);
  });

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

  header.addEventListener('click', (e) => {
    if (e.target === kebab) return;
    onOpen();
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
}

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
    const item = buildItemHeader(p, {
      dragType: 'application/x-cc-project',
      onReorder: reorderProject,
      onOpen: () => {
        const list = agentsForDir(p.dir);
        if (list.length) activate(list[0][0]);
        else newAgent(p);
      },
      menuItems: () => [
        { label: 'Open worktree', action: () => newAgent(p) },
        { label: 'Remove project', danger: true, action: () => removeProject(p.dir) },
      ],
    });
    item.appendChild(buildAgentList(p.dir));
    els.list.appendChild(item);
  }
}

function renderWorkspaces() {
  els.wsList.innerHTML = '';
  for (const w of state.workspacesData) {
    const item = buildItemHeader(w, {
      dragType: 'application/x-cc-workspace',
      onReorder: reorderWorkspace,
      onOpen: () => {
        const list = agentsForDir(w.dir);
        if (list.length) activate(list[0][0]);
        else spawn(w.dir, w.dir, null, true);
      },
      menuItems: () => [
        { label: 'New agent', action: () => spawn(w.dir, w.dir, null, true) },
        { label: 'Open in Explorer', action: () => window.api.openInExplorer(w.dir) },
        { label: 'Remove workspace', danger: true, action: () => removeWorkspace(w.dir) },
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
  for (const [id] of agentsForDir(dir)) removeAgent(id, true);
  state.projectsData = await window.api.removeProject(dir);
  renderSidebar();
}

async function removeWorkspace(dir) {
  const ok = await confirmDialog(
    'Remove workspace',
    'This removes the workspace from Command Center. The folder on disk is left untouched.',
    { okLabel: 'Remove', danger: true }
  );
  if (!ok) return;
  for (const [id] of agentsForDir(dir)) removeAgent(id, true);
  state.workspacesData = await window.api.removeWorkspace(dir);
  renderSidebar();
}

async function createWorkspace() {
  const name = await promptText('New workspace', 'workspace name');
  if (!name) return;
  const res = await window.api.createWorkspace(name);
  if (res.canceled) return;
  if (res.error) {
    await confirmDialog('Workspace creation failed', res.error, { alert: true });
    return;
  }
  await refreshProjects();
  // Launch an agent in the fresh workspace straight away.
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
// Esc clears the filter while the box is focused (immediate, no debounce).
els.sidebarFilter.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && filterText) {
    clearTimeout(filterTimer);
    els.sidebarFilter.value = '';
    filterText = '';
    applyFilter();
  }
});
