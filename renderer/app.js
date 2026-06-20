'use strict';

// Entry point. Imports wire up each module's event listeners as a side effect;
// this file only kicks off the initial render and the periodic refresh.

import { agents, loadDormant } from './state.js';
import { els } from './dom.js';
import { initTheme } from './settings.js';
import { refreshProjects } from './sidebar.js';
import './stage.js'; // stage toolbar + find-in-terminal wiring
import './prompts.js'; // smart prompts button wiring

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

initTheme();
loadDormant(); // resumable sessions from the previous run, shown as dormant rows
refreshProjects();

// Branch can change while you work; refresh the sidebar periodically.
setInterval(refreshProjects, 15000);
window.addEventListener('focus', refreshProjects);

// Char metrics depend on Cascadia Mono being loaded; once fonts are ready,
// refit every terminal so row/col counts match the real glyph size.
document.fonts.ready.then(() => {
  for (const a of agents.values()) a.refit();
});

// ---------------------------------------------------------------------------
// Resizable sidebar — drag the splitter to set --sidebar-w (clamped, persisted)
// ---------------------------------------------------------------------------

const root = document.documentElement;
const SIDEBAR_KEY = 'sidebarWidth';
const savedWidth = Number(localStorage.getItem(SIDEBAR_KEY));
if (savedWidth) root.style.setProperty('--sidebar-w', `${savedWidth}px`);

let resizing = false;
els.sidebarResizer.addEventListener('mousedown', (e) => {
  resizing = true;
  document.body.classList.add('resizing');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  const w = Math.min(560, Math.max(160, e.clientX));
  root.style.setProperty('--sidebar-w', `${w}px`);
});
window.addEventListener('mouseup', () => {
  if (!resizing) return;
  resizing = false;
  document.body.classList.remove('resizing');
  const w = parseInt(getComputedStyle(root).getPropertyValue('--sidebar-w'), 10);
  localStorage.setItem(SIDEBAR_KEY, w);
  // Stage width changed — refit every terminal to the new column.
  for (const a of agents.values()) a.refit();
});
