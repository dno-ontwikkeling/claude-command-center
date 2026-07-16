'use strict';

// ---------------------------------------------------------------------------
// Per-agent git cache. Fetching branch + diffstat spawns git in the single-
// threaded main process, which stalls every PTY — so we never do it during a
// render. Instead each agent caches branch/diffStat on itself; rows render from
// the cache, and this module refreshes it out-of-band (lazily when a row first
// appears, then on a foreground-only timer, and on demand). Split out of
// sidebar.js so the render path stays purely git-free.
// ---------------------------------------------------------------------------

import { agents } from './state.js';

// GitHub-style coloured diff badge: green +added, red -removed. Numbers only, so
// building the markup directly is safe.
export function fmtDiff(d) {
  if (!d || (!d.added && !d.removed)) return '';
  return `<span class="add">+${d.added}</span><span class="del">-${d.removed}</span>`;
}

// Refresh one agent's cached branch + diffstat, updating its row in place.
// `_gitBusy` dedupes concurrent fetches; `_gitFetched` gates the lazy first pull.
export function refreshAgentGit(id, a) {
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

export function refreshAllAgentsGit() {
  for (const [id, a] of agents) refreshAgentGit(id, a);
}

// Only poll while the window is in the foreground — a hidden/backgrounded window
// does no periodic git work. Returning to the window refreshes immediately.
setInterval(() => {
  if (document.visibilityState === 'visible') refreshAllAgentsGit();
}, 15000);
window.addEventListener('focus', refreshAllAgentsGit);
