'use strict';

import { els } from './dom.js';
import { state, agents, agentsForDir, dormantForDir, displayLabel, readLocalJson } from './state.js';
import { openMenu, promptText, confirmDialog } from './modals.js';
import { fmtDiff, refreshAgentGit } from './agent-git.mjs';
import { activate, killAndWait, removeAgent, renameAgent, deleteWorktree, resume, removeDormant, pruneDormantForDir, reorderAgent, forceStatus, spawn } from './agents.js';
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
const PTYPE_LABEL = { node: 'JS', dotnet: '.NET', go: 'GO', rust: 'RS', python: 'PY' };

// Kebab-menu icons. Trusted, hardcoded SVG literals (never interpolate a label
// into these — openMenu builds the icon and the label as separate DOM nodes).
// Feather-style: 14×14, stroke=currentColor so they inherit the item colour
// (incl. the red `.danger` variants).
const svgIcon = (inner) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  branch: svgIcon('<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'),
  plus: svgIcon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  folder: svgIcon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
  pencil: svgIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  activity: svgIcon('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
  play: svgIcon('<polygon points="5 3 19 12 5 21 5 3"/>'),
  trash: svgIcon('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  close: svgIcon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  minusCircle: svgIcon('<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>'),
  xCircle: svgIcon('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'),
};

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
      { label: 'Rename', icon: ICONS.pencil, action: () => renameAgent(id) },
      {
        label: 'Set status ▸',
        icon: ICONS.activity,
        submenu: [
          { label: 'Idle', icon: statusDot('st-idle'), action: () => forceStatus(id, 'idle') },
          { label: 'Busy', icon: statusDot('st-busy'), action: () => forceStatus(id, 'busy') },
          { label: 'Needs input', icon: statusDot('st-needs'), action: () => forceStatus(id, 'needs-input') },
          { label: 'Done', icon: statusDot('st-done'), action: () => forceStatus(id, 'done') },
        ],
      },
    ];
    // Only worktrees have a folder of their own to delete; the main worktree and
    // workspace agents (isMain) share the folder, so offer plain close only.
    if (!a.isMain) {
      items.push({ label: 'Delete worktree', icon: ICONS.trash, danger: true, action: () => deleteWorktree(id) });
    }
    items.push({ label: 'Close', icon: ICONS.close, danger: true, action: () => removeAgent(id) });
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
      { label: 'Resume', icon: ICONS.play, action: () => resume(id) },
      { label: 'Forget session', icon: ICONS.xCircle, danger: true, action: () => removeDormant(id) },
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
  chevron.textContent = isCollapsed ? '▸' : '▾';
  chevron.title = isCollapsed ? 'Expand' : 'Collapse';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = p.name;
  name.title = p.dir;

  const addBtn = document.createElement('button');
  addBtn.className = 'add-agent';
  addBtn.textContent = '+';
  addBtn.title = 'New agent';

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
// Esc clears the filter while the box is focused (immediate, no debounce).
els.sidebarFilter.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && filterText) {
    clearTimeout(filterTimer);
    els.sidebarFilter.value = '';
    filterText = '';
    applyFilter();
  }
});
