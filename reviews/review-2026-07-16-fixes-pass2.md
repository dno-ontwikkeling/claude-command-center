---
date: "2026-07-16"
author: "Olivier De Neef"
reviewers: "Multi-Agent (security, performance, architecture, simplicity, silent-failure, typescript, data-safety)"
pr: ""
branch: "review-fixes-2026-07-16"
target_ref: "f440944"
confidence_threshold: "70"
validated: "true (code-read confirmed before fixing)"
status: "resolved"
---
# Code Review (Pass 2): review-fixes-2026-07-16
**Date:** 2026-07-16
**Target:** re-review of the fixes applied for review-2026-07-16-full-app.md
**Reviewers:** 7 agents (security, performance, architecture, simplicity, silent-failure, typescript, data-safety)

## Summary
Re-review of the 19 shipped fixes found the fixes mostly correct, but surfaced **2 ineffective/incomplete fixes and 4 regressions/robustness gaps**. All 6 were verified by reading the actual code and **fixed in commit f440944**, then boot-verified.

- **P1 fixed:** 2 (ARCH-2 ineffective, SEC-1 incomplete)
- **P2 fixed:** 3 (stage.js leak, corrupt-store freeze-loop, hook-server crash)
- **P3 fixed:** 1 (writeJsonAtomic temp cleanup)
- **Deferred (not regressions):** 8 (see below)

---

## Fixed in this pass (commit f440944)

### [ARCH-1] Single-instance lock was ineffective (my ARCH-2 fix didn't work)
**File:** `main.js` (bootstrap)
**Confidence:** 80 → confirmed by code read
**Severity:** P1
**Issue:** `app.whenReady().then(...)` sat OUTSIDE the `else` of the lock check. `app.quit()` is async and does not halt the script, so a losing second instance still ran `registerIpc`/`startServer`/`createWindow` — exactly the JSON-store race the lock was meant to prevent.
**Fix:** Moved the whole `whenReady` bootstrap inside the lock-acquired branch. Boot-verified: a second instance now quits immediately while the first runs clean.

### [SEC-1] openInVSCode still command-injectable via full path
**File:** `main.js` `openInVSCode`
**Confidence:** 78
**Severity:** P1
**Issue:** The Windows path passed `cwd` as a bare argv to `cmd.exe /c`. libuv only auto-quotes args with whitespace/quotes, so a path containing `&`/`|`/`^` without spaces (e.g. an ordinary `C:\Shared\R&D\ws` folder) is re-parsed by cmd.exe as a command separator = real injection. `hasShellMeta` only guarded user-typed leaf names, not the parent folder (`filePaths[0]`) or `projects:add` paths.
**Fix:** Use `windowsVerbatimArguments: true` with explicit cmd `/s` quoting (`""code" "cwd""`) so metacharacters stay literal; refuse paths containing a literal `"`. Legitimate `&` folders now open correctly AND injection is closed at the choke point for all callers.

### [BUG-1] stage.js gitInFlight leaked on rejected IPC (my BUG-2 fix)
**File:** `renderer/stage.js` `runGit`
**Confidence:** 72
**Severity:** P2
**Issue:** No try/finally around `await window.api.gitFetch/gitPull`. If the invoke rejects (window torn down, future main-process throw), `gitInFlight.delete(action)` never runs → shared button permanently disabled, label stuck on "Fetch…".
**Fix:** Wrapped the git call in try/finally; in-flight state + button always reset.

### [DATA-1] Corrupt store froze app + spawned a backup every 15s (my DATA-1/2 fix)
**File:** `main.js` loadProjects/loadWorkspaces, backupBadFile
**Confidence:** 82
**Severity:** P2
**Issue:** `refreshProjects()` polls every 15s (and on focus). With a corrupt `projects.json`, each poll re-threw → blocking `dialog.showErrorBox` (freezes the whole main process incl. PTY delivery) AND a fresh `.bak-<ts>` copy, forever. Pressured users to delete the file — bypassing the very safety net.
**Fix:** `warnCorruptOnce` shows the dialog once per file per session; `backupBadFile` de-dupes via a `Map`, so at most one backup per file per session.

### [BUG-2] Hook HTTP server had no error handlers (crash risk)
**File:** `main.js` startServer
**Confidence:** 65
**Severity:** P2
**Issue:** No `req.on('error')` / `server.on('error')`. A client reset mid-body emits an 'error' with no listener → uncaught exception crashes the entire main process (and every live pty).
**Fix:** Added `req.on('error', () => res.destroy())` and `server.on('error', () => {})`.

### [BUG-3] writeJsonAtomic left orphaned temp files on failure
**File:** `main.js` writeJsonAtomic
**Confidence:** 75
**Severity:** P3
**Issue:** No cleanup of the temp file if write/rename threw; repeated failures accumulate `.tmp-*` files.
**Fix:** try/catch removes the temp before rethrowing. (Live file was already safe — atomicity preserved.)

---

## Verified correct (no action)
- PERF-1/2/3 caches + debounce: no timer/listener leak, cache bounded, dedupe via `.finally()` correct (performance reviewer).
- ARCH-1 pub/sub decoupling: cycle genuinely gone, subscriber registered before any event can fire, no double-render (architecture reviewer).
- DATA-4 branch delete: `-d` first, `-D` only after explicit confirm with safe default; checkbox opt-in (data-safety reviewer).
- DATA-5 worktree:remove: `cleanupIncomplete` correctly surfaced, never false success (data-safety, silent-failure).
- modals.js reentrancy, diff.js requestedMode guard, git:delete-branch async shape: correct (typescript reviewer).
- No new XSS/innerHTML in the UI files; CSP + contextIsolation intact (security reviewer).

---

## Deferred (not regressions — follow-up tickets)
| Finding | File | Sev | Note |
|---------|------|-----|------|
| Secret compare not constant-time | main.js hook server | P3 | Local-only 256-bit random; use `crypto.timingSafeEqual` |
| Cross-agent event forgery (shared secret) | main.js | P3 | Per-agent HMAC if trust boundary matters |
| saveProjects/saveWorkspaces write failures silent (SILENT-1 residual) | main.js | P2 | No data loss (live file untouched); add dialog/toast on write failure |
| record() dormant-schema duplicated in convertToDormant | state.js/agents.js | P2 | Export `record()`, reuse — avoids schema drift |
| hooksInstalled() blob `includes('report.js')` check | main.js | P3 | Per-event check for completeness |
| diff.js concurrent same-mode overwrite | diff.js | P3 | Add per-call monotonic token |
| refreshAllAgentsGit staggering / skip dead agents | sidebar.js | P3 | Offset interval; skip dead/error status |
| displayLabel dup 4× / execGit helper / file sizes | main.js, agents.js, sidebar.js | P3 | MAINT-1/2 from pass 1 |

---

## Verification
- `node --check` clean on all changed files.
- `electron .` boots clean and stays alive; second instance correctly quits (single-instance lock confirmed working).
