'use strict';

import { els } from './dom.js';
import { state, agentsForDir, dormantForDir } from './state.js';
import { openMenu } from './modals.js';
import { activate, removeAgent, renameAgent, deleteWorktree, resume, removeDormant } from './agents.js';
import { newAgent } from './worktree.js';

// ---------------------------------------------------------------------------
// Projects sidebar
// ---------------------------------------------------------------------------

export function renderSidebar() {
  els.list.innerHTML = '';

  for (const p of state.projectsData) {
    const item = document.createElement('li');
    item.className = 'project-item';

    // ---- project header ----
    const header = document.createElement('div');
    header.className = 'project';
    header.dataset.dir = p.dir;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    name.title = p.dir;

    const projectKebab = document.createElement('button');
    projectKebab.className = 'kebab';
    projectKebab.textContent = '⋮';
    projectKebab.title = 'Project options';

    header.append(name, projectKebab);
    item.appendChild(header);

    header.addEventListener('click', (e) => {
      if (e.target === projectKebab) return;
      const list = agentsForDir(p.dir);
      if (list.length) activate(list[0][0]);
      else newAgent(p);
    });

    projectKebab.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu(projectKebab, [
        { label: 'New agent', action: () => newAgent(p) },
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

      const rowKebab = document.createElement('button');
      rowKebab.className = 'kebab';
      rowKebab.textContent = '⋮';
      rowKebab.title = 'Agent options';

      row.append(dot, label, rowKebab);
      sub.appendChild(row);

      row.addEventListener('click', (e) => {
        if (e.target === rowKebab) return;
        activate(id);
      });
      rowKebab.addEventListener('click', (e) => {
        e.stopPropagation();
        const items = [{ label: 'Rename', action: () => renameAgent(id) }];
        if (!a.isMain) {
          items.push({ label: 'Remove worktree', danger: true, action: () => deleteWorktree(id) });
        }
        items.push({ label: 'Remove agent', danger: true, action: () => removeAgent(id) });
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
