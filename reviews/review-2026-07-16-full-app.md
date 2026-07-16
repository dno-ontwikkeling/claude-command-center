---
date: "2026-07-16"
author: "Olivier De Neef"
reviewers: "Multi-Agent (security, performance, architecture, simplicity, silent-failure, typescript, data-safety)"
pr: ""
branch: "main"
target_ref: "114f7b5763dd1c43769094f89269a854d98caa58"
confidence_threshold: "70"
validated: "false"
status: "triaged"
triaged_at: "2026-07-16T20:26:57Z"
triaged_by: "Olivier De Neef"
findings_total: "29"
findings_promoted: "19"
findings_skipped: "10"
stories_created: "001-c0b8:SEC-1,002-9154:DATA-1,003-51f8:DATA-2,004-d0e8:PERF-1,005-1218:PERF-2,006-a3bc:PERF-3,007-bcd3:SEC-2,008-bcac:SEC-3,009-e78b:DATA-3,010-6e73:DATA-4,011-bb16:DATA-5,012-ba67:DATA-6,013-21f9:BUG-1,014-0bf8:BUG-2,015-1521:BUG-3,016-5871:BUG-4,017-90ea:BUG-5,018-0ba4:ARCH-1,019-9b6b:ARCH-2"
---
# Code Review: Full App (claude-command-center, Electron)
**Date:** 2026-07-16
**Author:** Olivier De Neef
**Reviewers:** Multi-Agent (security, performance, architecture, simplicity, silent-failure, typescript, data-safety)
**Target:** Full application (main.js, preload.js, renderer/*)

<!-- Metadata authoritative in frontmatter. Bold lines kept for readability. -->

## Summary
- **P1 Critical Issues:** 6
- **P2 Important Issues:** 11
- **P3 Nice-to-Have:** 12 (top selection; more below threshold)
- **Confidence Threshold:** 70
- **Filtered Out (below threshold):** ~10 (P3 style/hardening at 40-60)
- **Validated:** not run (cross-confirmed by ≥2 agents instead)

Overall: Electron hardening solid (contextIsolation on, nodeIntegration off, curated preload, no remote content, strict-ish CSP, `execFile` array-args). Main risks: one command-injection surface, a systemic silent-data-loss persistence pattern, and a render-loop that spawns git subprocesses per row on every UI interaction.

---

## P1 - Critical (Block Merge)

### [SEC-1] Command injection via `code:open` (`execFile('code', [cwd], { shell: true })`)
**File:** `main.js:750-763` (handler `main.js:640`)
**Confidence:** 78
**Severity:** P1
**Issue:** `shell: true` routes `cwd` through `cmd.exe`. `cwd` derives from a git branch/workspace name only sanitized for `/` and `\` (`main.js:556-567`, `491`). Git refs may legally contain `&`, `%`, `(`, `)`, `!`. A hostile branch name (e.g. `feature&calc.exe`) pushed by any collaborator, opened as a worktree then launched in VS Code, executes an injected command. Exploitability debated across reviewers (path is app-derived, not free-form input) — hence P1 with moderate confidence.
**Fix:** Drop `shell: true`. Resolve `code.cmd`'s real path once (`where code`, cached) and `spawn(codeCmdPath, [cwd], { shell: false, windowsHide: true })`; or reject folder names with shell metacharacters at creation.

### [DATA-1] Corrupted config silently becomes empty then gets overwritten (permanent data loss)
**File:** `main.js:53-59` (`loadProjects`), `main.js:66-72` (`loadWorkspaces`)
**Confidence:** 85
**Severity:** P1
**Issue:** `catch { return []; }` treats a corrupt/truncated/permission-failed read identically to first-run. The next mutation (`projects:add/remove/reorder`) calls `saveProjects()` over the file, permanently destroying the real project/workspace registry with no warning.
**Fix:** Distinguish `ENOENT` from parse/IO errors. On the latter, back up the bad file (`.bak-<ts>`) and surface a dialog before any write.

### [DATA-2] Shared `~/.claude/settings.json` reset to `{}` and overwritten on parse failure
**File:** `main.js:307-341` (`ensureHooksInstalled`)
**Confidence:** 82
**Severity:** P1
**Issue:** Same anti-pattern on a file this app does NOT own — the CLI's global settings shared across all projects. Transient unreadable/corrupt state → `settings = {}` → user clicks Install → blank settings + hooks written, wiping permissions/model prefs/other hooks. No backup.
**Fix:** Same as DATA-1; never write a defaulted-empty settings object over an existing file that failed to parse.

### [PERF-1] `buildAgentRow` spawns `git branch` + `git diff --numstat` per row on every render
**File:** `renderer/sidebar.js:103-117`; handlers `main.js:220-254`, `650-669`, `768-773`
**Confidence:** 88
**Severity:** P1
**Issue:** `renderSidebar()` runs on 15s interval, focus, spawn/kill/rename/reorder/collapse, AND every filter keystroke. Each call spawns 2×N git child processes (N = visible agents). Main process is single-threaded and also forwards PTY I/O — spawn storms stall all terminals. Confirmed by perf, architecture, typescript reviewers.
**Fix:** Cache branch/diffstat per agent; refresh on a longer independent timer or explicit action; dedupe in-flight; never trigger from filter/collapse/reorder.

### [PERF-2] Filter input has no debounce; every keystroke does full sidebar rebuild
**File:** `renderer/sidebar.js:439-442`
**Confidence:** 90
**Severity:** P1
**Issue:** Each keystroke rebuilds the whole DOM tree and (via PERF-1) re-spawns 2×N git processes. Typing a 6-char filter with 10 agents ≈ up to 120 `execFile('git', …)` spawns.
**Fix:** Debounce 150-250ms; filtering should toggle row visibility (CSS), not rebuild data.

### [PERF-3] Synchronous recursive `detectProjectType` walk on every list call, on main thread
**File:** `main.js:132-167`, invoked via `enrich` (`main.js:443`) from `projects:list`/`workspaces:list`
**Confidence:** 85
**Severity:** P1
**Issue:** Depth-3 `fs.readdirSync` recursion per project AND workspace on every list — including the 15s auto-refresh — blocks the event loop that also forwards PTY `onData`/`onExit`. Project type never changes at runtime.
**Fix:** Cache result per dir; invalidate on add/remove. Also lowercase-compare `PTYPE_SKIP_DIRS` (`main.js:151`) so cased dir names aren't walked.

---

## P2 - Important (Fix Before/After Merge)

### [SEC-2] Stored HTML injection via unsanitized branch/ref names (`innerHTML`)
**File:** `renderer/worktree.js:108`, `:178`, `:186`
**Confidence:** 80
**Severity:** P2
**Issue:** `ref.label`/`b.name`/`r.name` from `git branch` inserted via `innerHTML`. CSP (`script-src 'self'`, no `unsafe-inline`) blocks script today, but this is a defense-in-depth failure enabling UI-spoof/phishing and full XSS under any future CSP relaxation. Rest of codebase uses `textContent` correctly.
**Fix:** Use `textContent`/DOM nodes (match `diff.js:218-240`, `worktree.js:150-173`).

### [SEC-3] Unauthenticated localhost hook-event server trusts arbitrary input
**File:** `main.js:347-371`; consumer `renderer/agents.js:539-588`
**Confidence:** 70
**Severity:** P2
**Issue:** `POST /event` on `127.0.0.1` has no shared secret. Any local process can spoof status/notifications and overwrite `agent.sessionId` (persisted, later used in `claude --resume <sessionId>`), redirecting session resumption.
**Fix:** Per-run random secret passed via env alongside `CC_PORT`/`CC_AGENT_ID`, required on `/event`; validate `agentId` against live map.

### [DATA-3] Non-atomic writes to all three JSON config files
**File:** `main.js:61-64`, `:74-77`, `:340`
**Confidence:** 78
**Severity:** P2
**Issue:** Direct `fs.writeFileSync` to live file. Crash/power-loss mid-write leaves truncated file, which DATA-1/DATA-2 then treat as empty and overwrite.
**Fix:** Write temp then `fs.renameSync`.

### [DATA-4] `git:delete-branch` uses `-D` (force) with no unmerged-commit warning
**File:** `main.js:623`; trigger `renderer/agents.js:254-256`, checkbox `:231`
**Confidence:** 75
**Severity:** P2
**Issue:** "Also delete the local branch" checkbox force-deletes regardless of merge/push status; unpushed commits become unreachable. Checkbox carries no warning.
**Fix:** Default to `-d`; only `-D` after explicit extra confirm, or check `git branch --merged`/upstream first.

### [DATA-5] `worktree:remove` always returns `{ok:true}` even when directory deletion failed
**File:** `main.js:580-600`, `rmDirRetry` `main.js:426-436`; consumer `renderer/agents.js:224-261`
**Confidence:** 73
**Severity:** P2
**Issue:** `rmDirRetry` gives up silently after 5 retries; handler unconditionally returns success. Renderer removes the row while a locked orphan directory remains. Flagged by silent-failure + data-safety.
**Fix:** Return success boolean from `rmDirRetry`; thread through so renderer can report incomplete cleanup.

### [DATA-6] Live session killed and dormant record purged even when worktree removal is aborted/fails
**File:** `renderer/agents.js:224-261` (kill at `:240`, unconditional `cleanupAgent` at `:260`)
**Confidence:** 70
**Severity:** P2
**Issue:** `killAndWait` kills pty before `git worktree remove`. If removal fails and user declines force, `cleanupAgent` still runs (`dormant.delete`, `persistAgents`) — app forgets the session while worktree+branch persist on disk. No UI path back to the conversation.
**Fix:** Kill pty only after removal (incl. force decision) confirmed; or restore dormant record on abort/failure.

### [BUG-1] Diff viewer mislabels content when mode tab switched mid-load
**File:** `renderer/diff.js:58-86` (mode re-read at `:72-73`, guard only on cwd at `:70`)
**Confidence:** 85
**Severity:** P2
**Issue:** `load()` captures `mode` before `await` for the fetch but re-reads current `mode` after for the subtitle. Concurrent loads (tabs never disabled) can show a wip diff labeled `vs origin/main` or vice versa.
**Fix:** `const requestedMode = mode;` at top; display and guard (`requestedMode !== mode`) on the captured value.

### [BUG-2] Stage-bar fetch/pull share global DOM state across agents — concurrent runGit stomp
**File:** `renderer/stage.js:12-45`
**Confidence:** 75
**Severity:** P2
**Issue:** `updateStageBar()` re-enables buttons on every `activate()`. Fetch on A, switch to B, fetch on B → two concurrent `runGit` share `btn`/`lbl`; first to finish resets disabled/label, corrupting the other's in-progress state.
**Fix:** Per-operation in-flight token independent of active agent.

### [BUG-3] `confirmDialog`/`promptText` not reentrant — second call orphans first Promise forever
**File:** `renderer/modals.js:62-122`
**Confidence:** 70
**Severity:** P2
**Issue:** Singleton overlay wired via `onclick =`. Two programmatic calls (e.g. two runGit failures from BUG-2) overwrite handlers on the same nodes; first Promise never resolves, its `await` stalls forever.
**Fix:** Queue concurrent modal requests, or guard callers.

### [BUG-4] `agent:input` has no dead-pty guard, unlike sibling `agent:resize`
**File:** `main.js:606` vs `:608-614`
**Confidence:** 68
**Severity:** P2
**Issue:** `resize` is try/caught for dead pty; `write` on same object in the same race window (keystroke as `onExit` fires) can throw. Being `ipcMain.on` (fire-and-forget), an uncaught throw becomes a main-process uncaught exception.
**Fix:** Wrap `write` in the same guard.

### [BUG-5] `projects:add`/`projects:remove` return un-enriched records → sidebar type icons vanish
**File:** `main.js:459-471`, `:473-477` (vs enriched `list`/`reorder`/workspace handlers); consumed `renderer/sidebar.js:398-402`, `430-433`
**Confidence:** 88
**Severity:** P2
**Issue:** These return raw `{dir,name}` while everything else `.map(enrich)`. After add/remove, every project loses its `type`/`isGit` icon until the next 15s poll. Flagged by architecture + simplicity.
**Fix:** Return `.map(enrich)` / `enrich(...)` like the workspace handlers.

### [ARCH-1] Circular import agents.js ↔ sidebar.js
**File:** `renderer/agents.js:9` imports `renderSidebar`; `renderer/sidebar.js:6` imports from agents.js
**Confidence:** 90
**Severity:** P2
**Issue:** Works only because every cross-call is inside a runtime function body; a top-level alias would break with an ESM TDZ error.
**Fix:** agents.js emits lifecycle events (pub/sub or app.js-registered callback); coordinator calls `renderSidebar()`.

### [ARCH-2] No `app.requestSingleInstanceLock()` — two instances race on JSON stores
**File:** `main.js` (absent; window created `main.js:793-803`)
**Confidence:** 82
**Severity:** P2
**Issue:** Second app instance races on `projects.json`/`workspaces.json`, compounding the non-atomic-write and lost-update issues.
**Fix:** Add single-instance lock; focus existing window on second launch.

---

## P3 - Nice-to-Have

### [PERF-4] `branches:list` refetches worktrees the renderer already fetched
**File:** `renderer/worktree.js:20-23` + `main.js:524-529`
**Confidence:** 88 — Doubles `git worktree list` + per-worktree `git status` each time the picker opens. Pass through one combined payload.

### [PERF-5] `activate()` iterates entire agents Map + fresh querySelectorAll per tab switch
**File:** `renderer/agents.js:368-389`
**Confidence:** 80 — O(N) classList toggles per click. Track prev active element; toggle only old/new.

### [PERF-6] Unthrottled mousemove mutating layout CSS vars during drags
**File:** `renderer/app.js:64-68`, `renderer/diff.js:394-399`
**Confidence:** 82 — Forces layout recalc per raw event. Wrap in `requestAnimationFrame`.

### [PERF-7] Diff viewer renders every hunk line as DOM node, no virtualization
**File:** `renderer/diff.js:297-373`, `197-201`
**Confidence:** 75 — Large diffs create thousands of nodes synchronously, freezing UI. Consider windowing / lazy per-file expansion.

### [PERF-8] `persistAgents()` fires on nearly every hook event, not on actual change
**File:** `renderer/agents.js:539-544`; source `hooks/report.js:25-35`
**Confidence:** 80 — Full localStorage serialize on every PreToolUse/Stop etc. Gate on whether `sessionId`/`used` actually changed.

### [PERF-9] Volume slider persists to localStorage on every `input` drag tick
**File:** `renderer/settings.js:208-214`
**Confidence:** 90 — Persist on `change` (drag-end), not `input`.

### [SILENT-1] `saveProjects`/`saveWorkspaces` unguarded; renderer call sites lack `.catch()`
**File:** `main.js:61-64`, `:74-77`; callers `renderer/sidebar.js:398-435`
**Confidence:** 70 — Write failure (disk full, AV lock) → unhandled rejection, UI silently no-ops (createWorkspace makes the folder but never registers it). Wrap and surface errors.

### [SILENT-2] Git helpers swallow all errors into empty/zero defaults
**File:** `main.js:170-191`, `220-235`, `238-254`, `259-282`, `650-669`
**Confidence:** 70 — `git` missing from PATH or broken repo shows as "clean/no branches" — indistinguishable from reality, undebuggable given zero logging in the codebase. Add minimal logging + distinguish error from empty.

### [SEC-4] Path traversal via `..` in workspace/branch names
**File:** `main.js:491`, `558-565`; guard `renderer/worktree.js:74-77`
**Confidence:** 60 — Only `/`/`\` stripped; bare `..` untouched. `workspaces:create` has no git validation, so `..` registers an ancestor dir. Reject `.`/`..` segments and verify resolved path stays inside parent.

### [SEC-5] `bypass: true` default enables `--dangerously-skip-permissions` out of the box
**File:** `renderer/settings.js:44`; used `main.js:383`, `renderer/agents.js:184`
**Confidence:** 60 — Every new agent skips Claude's confirmation gate by default, widening blast radius of any injection/prompt-injection. Default `false`; opt-in with warning.

### [MAINT-1] 12 hand-rolled `execFile('git', …)` wrappers; `runGit` used for only 3
**File:** `main.js:172,196,222,240,262,267,570,586,597,652,679,768`
**Confidence:** 85 — One `execGit(dir,args,opts)` helper removes ~40-60 lines and centralizes error handling.

### [MAINT-2] `displayLabel` expression copy-pasted 4× across 2 files
**File:** `renderer/sidebar.js:98,190`, `renderer/agents.js:216,596`
**Confidence:** 90 — Extract `displayLabel(a)` in state.js.

---

## Dismissed / Below Threshold (noted, not actioned)

- `openInVisualStudio` resolve-race swallows post-spawn errors (`main.js:736-744`) — conf 55.
- `beep()` overly broad catch hides note-math bugs (`renderer/sound.js:22-46`) — conf 55.
- `gitBranch` conflates "not a repo" with read errors (`main.js:83-101`) — conf 60.
- Heuristic prompt path sets needs-input but never `notify()` (`renderer/agents.js:454-491`) — conf 55; confirm intent.
- `loadFile` relative path instead of `__dirname` (`main.js:790`) — conf 40.
- `agentSeq.delete` may duplicate "Session N" label vs dormant (`renderer/agents.js:301`) — conf 60.
- `shell` local var shadows Electron `shell` module in `spawnAgent` (`main.js:378`) — conf 80 (rename, no bug).
- HTTP body concat with no size cap (`main.js:354-355`); no `req`/`server` error handlers (`main.js:347-371`) — conf 50.
- Global `document.onkeydown` in confirmDialog collides with diff viewer keydown (`renderer/modals.js:117`) — conf 40.
- God files: main.js (809), agents.js (608), sidebar.js (451), diff.js (424) — conf 75-80; split when it grows.

---

## Cross-Cutting Analysis

### Root Causes
| Root Cause | Findings | Suggested Fix |
|------------|----------|---------------|
| `catch → default empty` persistence pattern | DATA-1, DATA-2, DATA-3, SILENT-1, SILENT-2 | Distinguish ENOENT from errors; backup-before-write; atomic temp+rename; minimal logging facility |
| Full sidebar rebuild coupled to git subprocess spawns | PERF-1, PERF-2, PERF-3, PERF-4, ARCH-1 | Cache git data per agent; debounce filter; decouple render from data fetch |
| Singleton modal/DOM state, no reentrancy/in-flight guards | BUG-2, BUG-3, BUG-1 | Per-op tokens; modal queue; capture request params locally |
| Untrusted names reach shell/DOM/fs with only `/\` stripping | SEC-1, SEC-2, SEC-4 | Central name validator; textContent everywhere; no `shell:true` |
| Inconsistent IPC enrichment | BUG-5 | Enrich in every list-returning handler |

### Single-Fix Opportunities
1. **Safe persistence helper** (`readJsonSafe` + `writeJsonAtomic`) — fixes DATA-1, DATA-2, DATA-3, SILENT-1 (~30 lines).
2. **`execGit` helper** — fixes MAINT-1, gives one place for SILENT-2 logging (~40-60 lines removed).
3. **Decouple render from git fetch + debounce filter** — fixes PERF-1, PERF-2, PERF-4, part of ARCH-1.

### Context Files (read before fixing)
| File | Reason | Referenced By |
|------|--------|---------------|
| `main.js` | Persistence, IPC, git helpers, server | all |
| `renderer/sidebar.js` | Render loop + git-per-row | perf, arch, ts |
| `renderer/agents.js` | Agent lifecycle, status machine, persist | arch, silent, data |
| `renderer/state.js` | Shared mutable agent records | arch, simplicity |
| `hooks/report.js` | Hook event payload shape (drives PERF-8, SEC-3) | security, arch |

---

## Recommended Actions
1. **Immediate (before merge):** SEC-1, DATA-1, DATA-2, and the render/git spawn loop (PERF-1/2/3) — all combine single-user friction with data-loss/RCE surface.
2. **This PR:** SEC-2, SEC-3, DATA-3/4/5/6, BUG-1..5, ARCH-1/2.
3. **Follow-up tickets:** PERF-4..9, SEC-4/5, MAINT-1/2, god-file splits.

> Note: no automated finding-validation (Phase 4.5) or dependency scan (`npm audit`) was run. Findings above are cross-confirmed by ≥2 independent reviewers where confidence ≥70.
