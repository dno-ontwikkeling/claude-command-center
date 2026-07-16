'use strict';

// Entry point. Imports wire up each module's event listeners as a side effect;
// this file only kicks off the initial render and the periodic refresh.

import { agents, state, loadDormant, onAgentsChanged } from './state.js';
import { els } from './dom.js';
import { initTheme } from './settings.js';
import { refreshProjects, renderSidebar } from './sidebar.js';
import { refreshAllAgentsGit } from './agent-git.mjs';
import { installGlobalHandlers, log } from './logger.js';
import './stage.js'; // stage toolbar + find-in-terminal wiring
import './diff.js'; // GitKraken-style diff viewer wiring
import './prompts.js'; // smart prompts button wiring

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

installGlobalHandlers(); // record uncaught renderer errors to the main log file
log.info('renderer', 'boot'); // confirms the module graph loaded without a throw
initTheme();
// Coordinator wiring: agents.js emits lifecycle changes via state's pub/sub
// rather than importing the sidebar (which formed an import cycle). Register the
// re-render before any agent action can fire, so no change is missed.
// Keep the set of watched git dirs in sync with what's on screen (projects,
// workspaces, and live agent worktrees), so main can push 'git:changed'.
function syncWatch() {
  const dirs = new Set();
  for (const p of state.projectsData) dirs.add(p.dir);
  for (const w of state.workspacesData) dirs.add(w.dir);
  for (const a of agents.values()) if (a.cwd) dirs.add(a.cwd);
  window.api.setWatchDirs([...dirs]);
}

onAgentsChanged(() => {
  renderSidebar();
  syncWatch();
});
loadDormant(); // resumable sessions from the previous run, shown as dormant rows
refreshProjects().then(syncWatch);

// A git change in a watched repo (branch switch, commit, staging) pushes here;
// refresh the sidebar and per-agent branch/diff cache promptly.
window.api.onGitChanged(() => {
  refreshProjects();
  refreshAllAgentsGit();
});

// Event-driven above; this foreground poll is the correctness floor for cases
// fs.watch can't see (e.g. a worktree whose .git is a file). Paused while the
// window is hidden/blurred so a backgrounded window does no periodic work; focus
// and becoming-visible refresh immediately.
setInterval(() => {
  if (document.visibilityState === 'visible') refreshProjects();
}, 15000);
window.addEventListener('focus', refreshProjects);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshProjects();
});

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

// ---------------------------------------------------------------------------
// Compact mode — renderer-only density class, persisted
// ---------------------------------------------------------------------------

const COMPACT_KEY = 'compact';
function applyCompact(on) {
  document.body.classList.toggle('compact', on);
  els.compactBtn.classList.toggle('active', on);
  localStorage.setItem(COMPACT_KEY, on ? '1' : '');
  // Row heights/padding changed — refit terminals to the new metrics.
  for (const a of agents.values()) a.refit();
}
applyCompact(localStorage.getItem(COMPACT_KEY) === '1');
els.compactBtn.addEventListener('click', () =>
  applyCompact(!document.body.classList.contains('compact'))
);

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
