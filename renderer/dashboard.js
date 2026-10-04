'use strict';

import { els } from './dom.js';
import { ICONS } from './icons.mjs';
import { state, agents, agentsForDir, dormantForDir, onAgentsChanged, onStatusChanged } from './state.js';
import { promptText, confirmDialog, openMenu } from './modals.js';
import { activate, killAndWait, removeAgent, resume, pruneDormantForDir, spawn } from './agents.js';
import { newAgent } from './worktree.js';
import { renderSidebar, rowLabel } from './sidebar.js';
import { isDashboardVisible, setDashboard, onDashboardShown } from './view.js';

// ---------------------------------------------------------------------------
// Dashboard: the stage page for managing projects (git repos, agents open as
// worktrees) and workspaces (plain folders, agents start in place). Adding,
// forgetting and reordering them happens here; the board only lists agents.
// Owns the project/workspace data refresh, since both views render from it.
// ---------------------------------------------------------------------------

export async function refreshProjects() {
  const [projects, workspaces] = await Promise.all([window.api.listProjects(), window.api.listWorkspaces()]);
  state.projectsData = projects;
  state.workspacesData = workspaces;
  renderSidebar();
  renderDashboard();
}

// Both views after a project/workspace list change.
function renderAll() {
  renderSidebar();
  renderDashboard();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function seg(key, value) {
  const s = document.createElement('div');
  s.className = 'pass-seg';
  const k = document.createElement('span');
  k.className = 'ps-k';
  k.textContent = key;
  const v = document.createElement('span');
  v.className = 'ps-v';
  v.textContent = String(value);
  s.append(k, v);
  return s;
}

function renderSummary() {
  const live = [...agents.values()];
  const sleeping = state.projectsData.concat(state.workspacesData).reduce((n, x) => n + dormantForDir(x.dir).length, 0);
  els.dashSummary.replaceChildren(
    seg('Projects', state.projectsData.length),
    seg('Workspaces', state.workspacesData.length),
    seg('Running', live.length),
    seg('Sleeping', sleeping),
    seg('Needs you', live.filter((a) => a.status === 'needs-input').length)
  );
}

// One square per agent, each a button that opens (or resumes) that agent.
function agentSquares(dir) {
  const wrap = document.createElement('span');
  wrap.className = 'dash-squares';
  const entries = [...agentsForDir(dir).map(([id, a]) => [id, a, a.status]), ...dormantForDir(dir).map(([id, d]) => [id, d, 'dormant'])];
  for (const [id, x, st] of entries) {
    const b = document.createElement('button');
    b.className = 'dash-sq';
    b.title = st === 'dormant' ? `Resume ${rowLabel(x)}` : `Open ${rowLabel(x)}`;
    const dot = document.createElement('span');
    dot.className = `dot ${st}`;
    b.append(dot);
    b.addEventListener('click', () => (st === 'dormant' ? resume(id) : activate(id)));
    wrap.append(b);
  }
  return wrap;
}

function countText(dir) {
  const live = agentsForDir(dir).length;
  const asleep = dormantForDir(dir).length;
  const parts = [];
  if (live) parts.push(`${live} running`);
  if (asleep) parts.push(`${asleep} sleeping`);
  return parts.join(' · ') || 'No agents';
}

function buildRow(x, { dragType, onReorder, onAddAgent, addLabel, menuItems }) {
  const row = document.createElement('li');
  row.className = 'dash-row';

  const grip = document.createElement('span');
  grip.className = 'dash-grip';
  grip.innerHTML = ICONS.grip;

  const main = document.createElement('div');
  main.className = 'dash-main';
  const name = document.createElement('span');
  name.className = 'dash-name';
  name.textContent = x.name;
  const path = document.createElement('span');
  path.className = 'dash-path';
  path.textContent = x.dir;
  path.title = x.dir;
  main.append(name, path);

  const agentsCell = document.createElement('div');
  agentsCell.className = 'dash-agents';
  const count = document.createElement('span');
  count.className = 'dash-count';
  count.textContent = countText(x.dir);
  agentsCell.append(agentSquares(x.dir), count);

  const add = document.createElement('button');
  add.className = 'sb-btn dash-add';
  add.innerHTML = `${ICONS.plus}<span>${addLabel}</span>`;
  add.addEventListener('click', onAddAgent);

  const kebab = document.createElement('button');
  kebab.className = 'icon-btn kebab-btn';
  kebab.innerHTML = ICONS.kebab;
  kebab.title = 'Options';
  kebab.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu(kebab, menuItems());
  });

  row.append(grip, main, agentsCell, add, kebab);

  // Drag to reorder within its own list (distinct dataTransfer type keeps
  // projects and workspaces from cross-dropping).
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(dragType, x.dir);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  row.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes(dragType)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  row.addEventListener('drop', (e) => {
    const dragged = e.dataTransfer.getData(dragType);
    if (!dragged || dragged === x.dir) return;
    e.preventDefault();
    onReorder(dragged, x.dir);
  });

  return row;
}

function emptyRow(text) {
  const li = document.createElement('li');
  li.className = 'dash-empty';
  li.textContent = text;
  return li;
}

export function renderDashboard() {
  if (!isDashboardVisible()) return;
  renderSummary();

  const projects = state.projectsData.map((p) =>
    buildRow(p, {
      dragType: 'application/x-cc-project',
      onReorder: reorderProject,
      onAddAgent: () => newAgent(p),
      addLabel: 'Open worktree',
      menuItems: () => [
        { label: 'Open in Explorer', icon: ICONS.folder, action: () => window.api.openInExplorer(p.dir) },
        { label: 'Forget project', icon: ICONS.minusCircle, danger: true, action: () => removeProject(p.dir) },
      ],
    })
  );
  els.dashProjects.replaceChildren(
    ...(projects.length ? projects : [emptyRow('No projects yet. Add a git repository to open worktrees from it.')])
  );

  const workspaces = state.workspacesData.map((w) =>
    buildRow(w, {
      dragType: 'application/x-cc-workspace',
      onReorder: reorderWorkspace,
      onAddAgent: () => spawn(w.dir, w.dir, null, true),
      addLabel: 'New agent',
      menuItems: () => [
        { label: 'Open in Explorer', icon: ICONS.folder, action: () => window.api.openInExplorer(w.dir) },
        { label: 'Forget workspace', icon: ICONS.minusCircle, danger: true, action: () => removeWorkspace(w.dir) },
      ],
    })
  );
  els.dashWorkspaces.replaceChildren(
    ...(workspaces.length ? workspaces : [emptyRow('No workspaces yet. A workspace is a plain folder; agents start in it directly.')])
  );
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function reorderProject(draggedDir, targetDir) {
  const dirs = state.projectsData.map((p) => p.dir).filter((d) => d !== draggedDir);
  const at = dirs.indexOf(targetDir);
  if (at < 0) return;
  dirs.splice(at, 0, draggedDir);
  state.projectsData = await window.api.reorderProjects(dirs);
  renderAll();
}

async function reorderWorkspace(draggedDir, targetDir) {
  const dirs = state.workspacesData.map((w) => w.dir).filter((d) => d !== draggedDir);
  const at = dirs.indexOf(targetDir);
  if (at < 0) return;
  dirs.splice(at, 0, draggedDir);
  state.workspacesData = await window.api.reorderWorkspaces(dirs);
  renderAll();
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
  renderAll();
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
  renderAll();
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

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

els.dashAddProject.addEventListener('click', async () => {
  state.projectsData = await window.api.addProject();
  renderAll();
});
els.dashAddWorkspace.addEventListener('click', createWorkspace);

// The board footer button toggles the dashboard, returning to the active agent
// (refit + focus via activate) when there is one.
els.dashboardBtn.addEventListener('click', () => {
  if (isDashboardVisible() && state.activeId) activate(state.activeId);
  else setDashboard(true);
});

onDashboardShown(renderDashboard);
onAgentsChanged(renderDashboard);
onStatusChanged(renderDashboard);
