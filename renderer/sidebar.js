'use strict';

import { els } from './dom.js';
import { state, agentsForDir, dormantForDir } from './state.js';
import { openMenu } from './modals.js';
import { activate, removeAgent, renameAgent, deleteWorktree, resume, removeDormant, reorderAgent, forceStatus } from './agents.js';
import { newAgent } from './worktree.js';

// ---------------------------------------------------------------------------
// Projects sidebar
// ---------------------------------------------------------------------------

// GitHub-style coloured diff: green +added, red -removed. Numbers only, so
// building the markup directly is safe.
function fmtDiff(d) {
  if (!d || (!d.added && !d.removed)) return '';
  return `<span class="add">+${d.added}</span><span class="del">-${d.removed}</span>`;
}

// Short badge per detected project type (see detectProjectType in main.js).
const PTYPE_LABEL = { node: 'JS', dotnet: '.NET', go: 'GO', rust: 'RS', python: 'PY' };

// Collapsed projects (by dir) — persisted so the tree state survives a restart.
const COLLAPSED_KEY = 'collapsedProjects';
const collapsed = new Set(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || [];
    } catch {
      return [];
    }
  })()
);

function toggleCollapse(dir) {
  if (collapsed.has(dir)) collapsed.delete(dir);
  else collapsed.add(dir);
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  renderSidebar();
}

// Move a project before `targetDir` and persist the new order.
async function reorderProject(draggedDir, targetDir) {
  const dirs = state.projectsData.map((p) => p.dir).filter((d) => d !== draggedDir);
  const at = dirs.indexOf(targetDir);
  if (at < 0) return;
  dirs.splice(at, 0, draggedDir);
  state.projectsData = await window.api.reorderProjects(dirs);
  renderSidebar();
}

export function renderSidebar() {
  els.list.innerHTML = '';

  for (const p of state.projectsData) {
    const item = document.createElement('li');
    item.className = 'project-item';

    const isCollapsed = collapsed.has(p.dir);
    if (isCollapsed) item.classList.add('collapsed');

    // ---- project header ----
    const header = document.createElement('div');
    header.className = 'project';
    header.dataset.dir = p.dir;

    // Disclosure triangle: toggles the agent rows under this project.
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = isCollapsed ? '▸' : '▾';
    chevron.title = isCollapsed ? 'Expand' : 'Collapse';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    name.title = p.dir;

    const projectKebab = document.createElement('button');
    projectKebab.className = 'kebab';
    projectKebab.textContent = '⋮';
    projectKebab.title = 'Project options';

    const before = [chevron];
    if (p.type) {
      const icon = document.createElement('span');
      icon.className = `ptype ptype-${p.type}`;
      icon.textContent = PTYPE_LABEL[p.type] || '';
      icon.title = p.type;
      before.push(icon);
    }
    header.append(...before, name);

    // When collapsed, show how many rows are hidden so the project isn't blank.
    const hiddenCount = agentsForDir(p.dir).length + dormantForDir(p.dir).length;
    if (isCollapsed && hiddenCount) {
      const count = document.createElement('span');
      count.className = 'collapse-count';
      count.textContent = String(hiddenCount);
      count.title = `${hiddenCount} hidden`;
      header.append(count);
    }
    header.append(projectKebab);
    item.appendChild(header);

    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollapse(p.dir);
    });

    // Drag the header to reorder projects. A distinct dataTransfer type keeps
    // this separate from agent-row reordering (which uses text/plain).
    header.draggable = true;
    header.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-cc-project', p.dir);
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
      e.stopPropagation();
    });
    header.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('application/x-cc-project')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('drop', (e) => {
      const dragged = e.dataTransfer.getData('application/x-cc-project');
      if (!dragged || dragged === p.dir) return;
      e.preventDefault();
      reorderProject(dragged, p.dir);
    });

    header.addEventListener('click', (e) => {
      if (e.target === projectKebab) return;
      const list = agentsForDir(p.dir);
      if (list.length) activate(list[0][0]);
      else newAgent(p);
    });

    projectKebab.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu(projectKebab, [
        { label: 'Open worktree', action: () => newAgent(p) },
        { label: 'Remove project', danger: true, action: () => removeProject(p.dir) },
      ]);
    });

    // ---- agent rows ----
    const sub = document.createElement('ul');
    sub.className = 'agents';
    for (const [id, a] of agentsForDir(p.dir)) {
      const row = document.createElement('li');
      row.className = 'agent';
      row.dataset.id = id;
      if (id === state.activeId) row.classList.add('active');

      const dot = document.createElement('span');
      dot.className = `dot ${a.status}`;
      a.dotEl = dot;

      const label = document.createElement('span');
      label.className = 'agent-label';
      label.textContent = a.customLabel || (a.branch ? `⎇ ${a.branch}` : a.label);
      label.title = a.cwd;

      // Branch can change under us (user runs git switch in the terminal), so
      // re-read it from git. Skip when a custom label overrides the display.
      window.api.gitBranch(a.cwd).then((b) => {
        if (!b || b === a.branch) return;
        a.branch = b;
        if (!a.customLabel) label.textContent = `⎇ ${b}`;
      });

      // Uncommitted diff size vs HEAD, e.g. "+23/-4". Show the cached value
      // immediately, then refresh from git asynchronously.
      const diff = document.createElement('span');
      diff.className = 'agent-diff';
      if (a.diffStat) diff.innerHTML = fmtDiff(a.diffStat);
      window.api.gitDiffStat(a.cwd).then((d) => {
        a.diffStat = d;
        diff.innerHTML = fmtDiff(d);
      });

      const rowKebab = document.createElement('button');
      rowKebab.className = 'kebab';
      rowKebab.textContent = '⋮';
      rowKebab.title = 'Worktree options';

      row.append(dot, label, diff, rowKebab);
      sub.appendChild(row);

      // Drag to reorder within the project.
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
        if (!a.isMain) {
          items.push({ label: 'Delete worktree', danger: true, action: () => deleteWorktree(id) });
        }
        items.push({ label: 'Close worktree', danger: true, action: () => removeAgent(id) });
        openMenu(rowKebab, items);
      });
    }

    // ---- dormant agents (resumable sessions whose pty has gone) ----
    for (const [id, d] of dormantForDir(p.dir)) {
      const row = document.createElement('li');
      row.className = 'agent dormant';
      row.dataset.id = id;
      row.title = 'Resume this session';

      const dot = document.createElement('span');
      dot.className = 'dot dormant';

      const label = document.createElement('span');
      label.className = 'agent-label';
      label.textContent = d.customLabel || (d.branch ? `⎇ ${d.branch}` : d.label);
      label.title = d.cwd;

      const rowKebab = document.createElement('button');
      rowKebab.className = 'kebab';
      rowKebab.textContent = '⋮';
      rowKebab.title = 'Session options';

      row.append(dot, label, rowKebab);
      sub.appendChild(row);

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
    }

    item.appendChild(sub);
    els.list.appendChild(item);
  }
}

export async function refreshProjects() {
  state.projectsData = await window.api.listProjects();
  renderSidebar();
}

async function removeProject(dir) {
  for (const [id] of agentsForDir(dir)) removeAgent(id, true);
  state.projectsData = await window.api.removeProject(dir);
  renderSidebar();
}

els.addBtn.addEventListener('click', async () => {
  state.projectsData = await window.api.addProject();
  renderSidebar();
});
