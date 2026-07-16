---
date: "2026-07-17"
author: "Olivier De Neef"
reviewers: "Multi-Agent (security, performance, architecture, simplicity, silent-failure, test-quality, typescript, data-safety)"
pr: ""
branch: "main"
target_ref: "7aef37345ad2234e36af4313f71de5213c5b9ec9"
confidence_threshold: "70"
validated: "true"
status: "triaged"
triaged_at: "2026-07-17T09:30:00Z"
triaged_by: "Olivier De Neef"
findings_total: "23"
findings_promoted: "23"
findings_skipped: "0"
stories_created: "020-aaba:DATA-1,021-f40e:TYPE-1,022-5b2a:TYPE-2,023-5a57:PERF-1,024-7ba9:BUG-1,025-87be:DATA-3,026-08ba:PERF-2,027-21c9:BUG-2,028-16cc:TEST-1,029-15da:TEST-2,030-7578:SEC-1,031-62a4:BUG-3,032-0e24:STYLE-5,033-238a:STYLE-1"
---
# Code Review: Full App (claude-command-center, Electron)
**Date:** 2026-07-17
**Author:** Olivier De Neef
**Reviewers:** Multi-Agent (security, performance, architecture, simplicity, silent-failure, test-quality, typescript, data-safety)
**Target:** Whole source tree @ 7aef373 (~5200 LOC)

<!-- Metadata authoritative in frontmatter. Bold lines kept for readability. -->

## Summary
- **P1 Critical:** 1
- **P2 Important:** 8
- **P3 Nice-to-Have:** 14
- **Confidence Threshold:** 70 (SEC findings kept below threshold — security exception)
- **Validated:** 4 findings flow-traced, 0 dismissed, 1 downgraded (SEC-1 70→60)
- **Overall:** Mature codebase. Strong Electron hardening (contextIsolation, no nodeIntegration, CSP, execFile-only, HMAC per-agent hook tokens, atomic JSON writes, single-instance lock). Main themes: (1) IPC type contract drifted + can't be enforced by current typecheck, (2) bulk session teardown lacks the dormant-preservation the single-agent path has, (3) security-critical modules untested.

---

## P1 - Critical (Block Merge)

### [DATA-1] `removeProject` destroys live resumable sessions with no confirmation
**File:** `renderer/sidebar.js:389-393`, `renderer/agents.js:369-372,299-321`
**Confidence:** 88 (validated, flow-traced)
**Severity:** P1
**Issue:** Project kebab → "Remove project" (`danger:true`) fires `removeProject(dir)` directly with NO `confirmDialog` — unlike `removeWorkspace`, which confirms. It loops `agentsForDir(dir)` calling `removeAgent(id, true)`, which does `kill(id)` then unconditionally `cleanupAgent()` — never `convertToDormant()`. Any in-progress Claude session with a valid `sessionId`/`used=true` (normally preserved as resumable on natural exit) is permanently discarded. One misclick kills every running agent for the project and destroys resumability.
**Fix:** Add a `confirmDialog` to `removeProject` (match `removeWorkspace`), and convert resumable agents to dormant instead of `cleanupAgent` — reuse the single-agent `deleteWorktree` preservation path.

---

## P2 - Important

### [TYPE-1] IPC type contract (`types/ipc.d.ts`) has drifted from runtime in 4+ handlers
**File:** `types/ipc.d.ts:72,73,78,105,106` vs `main.js:598-614,620-655,796-815,399-406`
**Confidence:** 95 (three reviewers traced to consumers)
**Severity:** P2
**Issue:** Declared shapes no longer match reality; renderer code follows the real shape, so the `.d.ts` is stale:
- `listBranches` — declared `{local:string[],remote:string[],worktrees:Worktree[]}`; actual `{current, local:{name,hasWorktree}[], remote:{name,hasLocal}[]}` (no `worktrees`).
- `createWorktree` — declared `{dir?,error?}`; actual `{path,branch}` or `{canceled:true}`.
- `gitDiff`/`DiffResult` — declared `{diff,base?}`; actual `{ok,error}` / `{ok,diff,base}`.
- `onExit` — declared `{id,code?}`; actual `{id,exitCode}` or `{id,error}`.
- `onEvent` — missing the `event` field that `agents.js:534` branches on.
**Fix:** Rewrite the four/five declarations to match the shapes renderer consumers already rely on.

### [TYPE-2] Typecheck cannot catch return-shape drift (root cause of TYPE-1)
**File:** `jsconfig.json:6` (`checkJs:false`), `tsconfig.typecheck.json:16`, `types/electron.d.ts:10`
**Confidence:** 95
**Severity:** P2
**Issue:** `checkJs:false` means nothing in the app is actually checked except via `npm run typecheck`, whose `files` is only `["preload.js","types/ipc.d.ts"]` — `main.js` and renderer consumers are never checked against the contract. And the electron stub types `ipcRenderer.invoke():Promise<any>`, so `any` is assignable to any declared return → return-shape drift is structurally uncatchable. The contract file gives false confidence, not real safety (this is how TYPE-1 drifted undetected).
**Fix:** Either type the stub's `invoke` per-channel (discriminated union keyed by channel) so return shapes are verified, or add `main.js` + renderer files to the typecheck `include`. At minimum correct the `preload.js:6-8` comment that claims renderer-side enforcement.

### [PERF-1] Unscoped `git:changed` fan-out spawns N git subprocesses per repo change
**File:** `main.js:457-491,477`, `renderer/app.js:45-48`, `renderer/agent-git.mjs:44-46`
**Confidence:** 88
**Severity:** P2
**Issue:** The `fs.watch` callback discards which dir changed and calls `scheduleGitChanged()`; renderer `onGitChanged` then unconditionally runs `refreshProjects()` + `refreshAllAgentsGit()`, and the latter spawns `git diff --numstat HEAD` for EVERY live agent, not just the one whose repo changed. A single stage/commit in one worktree = N subprocesses (N = total agent count) per 400ms debounce window.
**Fix:** Pass the changed dir through the IPC payload; refresh only agents whose `cwd` is under it.

### [BUG-1] Resume-after-spawn-failure error is destroyed before it can render
**File:** `renderer/agents.js:500-528,172,326-344`
**Confidence:** 80 (validated, traced)
**Severity:** P2
**Issue:** On resume, `used` is set `true` unconditionally (`agents.js:172`). If the pty fails to start (worktree cwd deleted, `claude` missing), `agent:exit` arrives with `error`; the handler writes the error to `a.term` then — because `sessionId && used && !intentional` — immediately calls `convertToDormant(id)` which synchronously `term.dispose()` + `el.remove()`, tearing down the terminal before the text paints. Repeated "Resume" clicks reproduce silently with zero user-visible signal.
**Fix:** When `error` is present, skip `convertToDormant` and surface a dialog/toast instead of writing to a terminal that's about to be disposed.

### [DATA-3] Destructive confirm dialogs default-focus OK and bind Enter to confirm
**File:** `renderer/modals.js:100-140,119,135-138`
**Confidence:** 72 (validated)
**Severity:** P2
**Issue:** `confirmDialog` always `confirmOk.focus()` and binds a document-level `Enter → done(true)`, even when `opts.danger` is true (delete worktree, force-delete branch, remove workspace). `danger` only toggles a CSS class. In a terminal-heavy UI where Enter is the most-pressed key, a stray/queued Enter confirms a destructive action.
**Fix:** For `danger` variants, focus Cancel by default (or require a distinct confirmation), and scope the Enter handler to the overlay.

### [PERF-2] Synchronous `fs.rmSync` in worktree delete blocks the main thread
**File:** `main.js:433-444` (`rmDirRetry`)
**Confidence:** 65
**Severity:** P2
**Issue:** `fs.rmSync(target, {recursive:true, force:true})` runs on the main process's single thread. Deleting a worktree with a large `node_modules`/`bin`/`obj` tree freezes every other agent's PTY pump and all pending IPC for the duration.
**Fix:** Use async `fs.promises.rm`, keep the retry loop, await it.

### [BUG-2] `persistAgents()` has no guard around `localStorage.setItem`
**File:** `renderer/state.js:105-114`
**Confidence:** 62
**Severity:** P2
**Issue:** Synchronous throw (quota, private-mode, non-serializable field) is uncaught. `spawn()` calls `persistAgents()` before `notifyAgentsChanged()`/`activate(id)`; a throw aborts those, leaving a live pty in main with no sidebar row — split-brain. The read side (`readLocalJson`) is defensively wrapped; the write side isn't.
**Fix:** try/catch around persist with a logged warning.

### [TEST-1] Security-hardened `editors.js` has zero tests
**File:** `editors.js` (no `test/editors.test.js`)
**Confidence:** 95
**Severity:** P2 (criticality high)
**Issue:** File documents a real previously-fixed command-injection (branch-derived path → cmd.exe) and implements the mitigations (`"` rejection, `windowsVerbatimArguments` + manual quoting). No test guards it — a "simplifying" refactor could silently reintroduce the injection.
**Fix:** Test: `openInVSCode` rejects cwd containing `"`; builds expected verbatim line for paths with `&`/`|`/spaces; cache doesn't re-invoke `where`; non-win32 returns error without fs touch.

### [TEST-2] `main.js` hook HTTP server + settings-merge untested
**File:** `main.js:313-373` (server), `main.js:250-307` (`ensureHooksInstalled`)
**Confidence:** 93
**Severity:** P2
**Issue:** The actual security enforcement (`agents.has(id)` + `secretMatches`, 404/403/200 paths, 64KB cutoff, malformed-JSON) is untested — `hookauth.test.js` only tests the pure crypto helpers in isolation. The hook-merge into the user's shared `~/.claude/settings.json` (a file the app doesn't own) is also untested; a bug could corrupt a user's existing Claude settings.
**Fix:** Extract the request handler + merge logic into electron-free testable functions (as done for `gitinfo.js`/`jsonstore.js`); integration-test the server with a fake `agents` map.

---

## P3 - Nice-to-Have

### [SEC-1] Git argument injection via ref names starting with `-`
**File:** `main.js:626-654,722-743`, `jsonstore.js:79` (`hasShellMeta`)
**Confidence:** 60 (validated; downgraded from 70 — argument-confusion/DoS, not RCE)
**Severity:** P3
**Issue:** `hasShellMeta` blocks shell metachars but not a leading `-`. A remote branch named `-x` (attacker with remote push access, `mode:'remote'`) flows unguarded into `git worktree add ... -b <branch> <base>` / `git branch -d <branch>`. `worktree add`/`branch -d` don't expose an `--upload-pack`-style RCE, so blast radius is git operation failure/argument confusion, not code execution.
**Fix:** Insert `--` before positional ref/base args; and/or reject leading `-` in ref names.

### [SEC-2] IPC handlers trust `dir`/`cwd` without resource-level authorization
**File:** `main.js:716,717,722,747,757,760,763,770,796`
**Confidence:** 55
**Severity:** P3
**Issue:** git/openPath/editor handlers act on any path the renderer supplies without checking it belongs to a registered project/workspace/agent. Not reachable today (no XSS, no remote content) but removes a defense-in-depth layer if the renderer is ever compromised.
**Fix:** Validate incoming `dir`/`cwd` against `loadProjects()`/`loadWorkspaces()`/`agents` before acting.

### [SEC-3] Hook HTTP server has no socket/read timeout
**File:** `main.js:313-373`
**Confidence:** 60
**Severity:** P3
**Issue:** Body capped at 64KB but no `server.setTimeout`; a connection that opens and never sends stays open. Local-only (127.0.0.1) so low impact.
**Fix:** `server.setTimeout(5000)` / `req.setTimeout` with destroy.

### [SEC-4] Latent `innerHTML` sink in `openMenu`
**File:** `renderer/modals.js:20`
**Confidence:** 65
**Severity:** P3
**Issue:** `b.innerHTML = \`${it.icon}<span>${it.label}</span>\`` — the one innerHTML sink; `label` is interpolated unescaped when `icon` is set. All callers pass static SVG today, so not exploitable, but latent XSS if repo/user text is ever threaded through an icon menu item.
**Fix:** Build icon as a DOM node; set label via `textContent`.

### [SEC-5] Electron: no explicit `sandbox:true`, no navigation/window-open guard
**File:** `main.js:831-843`
**Confidence:** 50
**Severity:** P3
**Issue:** Defaults are currently safe, but `sandbox:true`, `setWindowOpenHandler(deny)`, and a `will-navigate` guard are standard hardening and cheap insurance against future/dependency regressions.
**Fix:** Add all three explicitly.

### [BUG-3] Git `execFile` errors swallowed with no logging (5 sites)
**File:** `main.js:159-197,770-789`
**Confidence:** 80
**Severity:** P3
**Issue:** `worktreeStatus`/`listWorktrees`/`listBranches`/`listRemoteBranches`/`git:diffstat` map any git error to a legit empty state with zero log output. On a 15s poll, a broken environment (git not on PATH, corrupt repo) shows a permanently empty sidebar with no diagnostic trail.
**Fix:** `log.warn(...)` before falling back to the default.

### [BUG-4] `git:diffstat` missing `maxBuffer` override (masked by BUG-3)
**File:** `main.js:770-789`
**Confidence:** 55
**Severity:** P3
**Issue:** `git:diff` sets `maxBuffer: 64MB`; `git:diffstat` uses the 1MB default. A large diff overflows, errors, and (per BUG-3) is silently shown as a clean `{added:0,removed:0}` badge.
**Fix:** Apply the same `maxBuffer`; log the swallowed error.

### [BUG-5] `eventHasReport` uses a fragile substring match
**File:** `hookauth.js:28-32`
**Confidence:** 55
**Severity:** P3
**Issue:** `h.command.includes('report.js')` treats any unrelated hook containing that literal (e.g. a user's `generate-report.js`) as "already installed," silently skipping install of the real hook.
**Fix:** Match on the resolved `REPORT_SCRIPT` path.

### [PERF-3] Two independent 15s pollers duplicate background git load
**File:** `renderer/agent-git.mjs:50-52`, `renderer/app.js:54-56`
**Confidence:** 75
**Severity:** P3
**Issue:** `refreshAllAgentsGit` and `refreshProjects` each run on their own foreground-gated 15s interval; combined with PERF-1's fan-out this doubles steady-state subprocess/IPC load.
**Fix:** Coalesce into one scheduler once PERF-1 is scoped.

### [STYLE-1] Volume slider persists to localStorage on every drag tick
**File:** `renderer/settings.js:202-205`
**Confidence:** 85
**Severity:** P3
**Issue:** The `'input'` handler calls `saveSettings()` on every tick; only the beep-preview was moved to `'change'`. Every other setting persists on `'change'`.
**Fix:** Move `saveSettings()` to the `'change'` handler.

### [STYLE-2] `PTYPE_SKIP_DIRS` is a dead export
**File:** `gitinfo.js:40-55,153`
**Confidence:** 85
**Severity:** P3
**Issue:** Exported but only used internally; no importer.
**Fix:** Drop the export.

### [STYLE-3] `execFile('git', …)` boilerplate duplicated ~12×; `runGit` underused
**File:** `main.js:161,174,184,193,205,210,647,663,674,772,799` vs `main.js:818-825`
**Confidence:** 78
**Severity:** P3
**Issue:** Inline promise/error-handling wrapper repeated at every parsing call site; `runGit` is reused by only 3.
**Fix:** Shared `execGit(dir, args, opts) → {code,stdout,stderr}`.

### [STYLE-4] `String(err.message || err)` repeated 11× / god-file growth
**File:** `main.js` (multiple), `editors.js` (multiple); `main.js` 880 lines
**Confidence:** 72
**Severity:** P3
**Issue:** `errMsg(err)` helper would remove ~10 dup lines. Separately, `main.js` keeps growing against the codebase's own extract-to-module pattern — worktree/branch git orchestration (`listWorktrees`/`listBranches`/`resolveDiffBase` + `worktree:*`/`branches:*` handlers) is the natural next `gitops.js` extraction.
**Fix:** Add `errMsg` helper; extract a `gitops.js` module.

### [STYLE-5] `renderer/agents.js` mixes 5 responsibilities
**File:** `renderer/agents.js` (602 lines)
**Confidence:** 80
**Severity:** P3
**Issue:** Owns terminal construction, agent lifecycle, worktree-deletion workflow, the busy/idle/needs-input status state machine, and notifications. The status engine (`setStatus`/`markActivity`/`detectPrompts`/`onEvent`) is the clean extraction, mirroring the existing `tui-signals.mjs` (pure) / `agent-git.mjs` (impure) split.
**Fix:** Extract the status state machine into its own module.

### [DATA-2] Dormant sessions orphaned when project/workspace removed
**File:** `renderer/sidebar.js:389-405`, `renderer/state.js:38-40`
**Confidence:** 72
**Severity:** P3
**Issue:** `removeProject`/`removeWorkspace` only iterate `agentsForDir` (live map); existing `dormant` entries for that dir are never deleted — they linger in `localStorage['savedAgents']` forever, invisible, unrecoverable.
**Fix:** Also prune `dormantForDir(dir)` records on removal.

### [PERF-4] Sidebar full-rebuild + O(P×A) rescans on every lifecycle event
**File:** `renderer/sidebar.js:317-373`, `renderer/state.js:32-40`
**Confidence:** 55
**Severity:** P3
**Issue:** Every spawn/rename/remove does `list.innerHTML=''` and rebuilds all rows + relistens; `agentsForDir`/`dormantForDir` rescan all agents twice per project. Fine now, quadratic with growth.
**Fix:** Build a `Map<dir, entries>` once per render; patch the single changed row.

### [BUG-6] Case-sensitive path dedup on Windows
**File:** `main.js:530,570`
**Confidence:** 55
**Severity:** P3
**Issue:** `p.dir === dir` strict-equality dedup; Windows FS is case-insensitive, so the same folder with different casing registers twice.
**Fix:** Normalize case (or `realpathSync`) before comparing.

### [STYLE-6] `collapsedProjects` localStorage never pruned
**File:** `renderer/sidebar.js:24-25` vs `389-405`
**Confidence:** 55
**Severity:** P3
**Issue:** Removed project/workspace dirs linger forever in the persisted `collapsed` Set — slow, permanent stale-key growth.
**Fix:** Delete the dir from `collapsed` on removal.

---

## Cross-Cutting Analysis

### Root Causes
| Root Cause | Findings | Suggested Fix |
|---|---|---|
| IPC contract not enforceable (checkJs off, stub `invoke:Promise<any>`, main.js not checked) | TYPE-1, TYPE-2, + spawn/open-external mismatches | Type `invoke` per-channel or add main.js/renderer to typecheck |
| Bulk teardown skips the dormant-preservation the single-agent path has | DATA-1, DATA-2, BUG-1 | Route all teardown through convert-to-dormant + confirm |
| Git errors mapped to empty state with no logging | BUG-3, BUG-4, PERF-1 | Shared `execGit` helper that logs failures; scope fan-out |
| main.js god-file vs codebase's own extract pattern | STYLE-4, STYLE-5, TEST-2 | Extract `gitops.js` + status engine; test the extracts |

### Single-Fix Opportunities
1. **Shared `execGit(dir,args)` helper** — fixes STYLE-3, enables BUG-3/BUG-4 logging in one place (~20 lines).
2. **Route teardown through convert-to-dormant + confirm** — fixes DATA-1 (P1) and DATA-2 together.
3. **Fix the 5 `ipc.d.ts` declarations** — closes TYPE-1 entirely (trivial, high value).

### Context Files (read before fixing)
| File | Reason | Referenced By |
|---|---|---|
| `renderer/agents.js` | Teardown + status + resume logic | data-safety, silent-failure, architecture |
| `main.js` | IPC handlers, git orchestration, hook server | security, perf, typescript, test |
| `types/ipc.d.ts` + `types/electron.d.ts` | The contract that's drifted + why it isn't checked | typescript, architecture, simplicity |
| `renderer/modals.js` | Confirm-dialog focus/Enter behavior | data-safety, security |
| `jsonstore.js` | `hasShellMeta`, atomic writes | security, data-safety |

## Recommended Actions
1. **Immediate (before merge-worthy work):** DATA-1 (P1 — add confirm + dormant preservation to `removeProject`).
2. **This pass:** TYPE-1/TYPE-2 (fix contract + make typecheck real), PERF-1 (scope git fan-out), BUG-1 (resume failure), DATA-3 (safe default on danger dialogs), PERF-2 (async rm), the two test gaps (editors.js, hook server).
3. **Follow-up tickets:** the P3 SEC hardening cluster, the STYLE/dedup cleanups, gitops.js + status-engine extraction.
