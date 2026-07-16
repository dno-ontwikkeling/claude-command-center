'use strict';

// ---------------------------------------------------------------------------
// Per-agent git cache. Fetching branch + diffstat spawns git in the single-
// threaded main process, which stalls every PTY — so we never do it during a
// render. Instead each agent caches branch/diffStat on itself; rows render from
// the cache, and this module refreshes it out-of-band (lazily when a row first
// appears, on demand, and via app.js's shared foreground timer/event-driven
// git:changed handler — no timer of its own here). Split out of sidebar.js so
// the render path stays purely git-free.
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

// True if `cwd` is `dir` itself or nested under it. Path-string comparison
// only (no fs access from the renderer); normalizes separators and case so it
// still works with mixed slashes and Windows' case-insensitive paths.
function isUnderDir(cwd, dir) {
  if (!cwd || !dir) return false;
  const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const c = norm(cwd);
  const d = norm(dir);
  return c === d || c.startsWith(`${d}/`);
}

// `dir`, when given, scopes the refresh to agents whose cwd is under that dir —
// a single-repo git change (e.g. a commit in one worktree) shouldn't spawn a
// `git diff` for every other live agent. Omit `dir` for a full refresh (the
// foreground poll floor, and the fallback when the changed dir is unknown).
export function refreshAllAgentsGit(dir) {
  for (const [id, a] of agents) {
    if (dir && !isUnderDir(a.cwd, dir)) continue;
    refreshAgentGit(id, a);
  }
}
