'use strict';

// Entry point. Imports wire up each module's event listeners as a side effect;
// this file only kicks off the initial render and the periodic refresh.

import { agents, loadDormant } from './state.js';
import { initTheme } from './settings.js';
import { refreshProjects } from './sidebar.js';

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
