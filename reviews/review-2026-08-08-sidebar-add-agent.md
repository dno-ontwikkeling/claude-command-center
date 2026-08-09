---
date: "2026-08-08"
author: "Olivier De Neef"
reviewers: "Multi-Agent (typescript, architecture, simplicity, silent-failure)"
pr: ""
branch: "main"
target_ref: "66487de (uncommitted working tree)"
confidence_threshold: "70"
validated: "false"
status: "open"
---
# Code Review: sidebar.js header-click → collapse + `+` add-agent button (uncommitted)

**Date:** 2026-08-08
**Author:** Olivier De Neef
**Reviewers:** Multi-Agent (typescript, architecture, simplicity, silent-failure)
**Target:** Uncommitted changes — `renderer/sidebar.js`, `renderer/style.css`

<!-- Metadata is authoritative in frontmatter above. -->

## Summary
- **P1 Critical Issues:** 0
- **P2 Important Issues:** 1
- **P3 Nice-to-Have:** 3
- **Confidence Threshold:** 70
- **Filtered Out (below threshold):** 3 (async fire-and-forget C55, tooltip label C65, parent/child click asymmetry C45)
- **Validated:** skipped (no findings ≥ threshold in SEC/DATA; all quality-tier)

Change is clean and correct. No double-toggle, no dead imports (`activate` still used at `sidebar.js:127`), no leftover `onOpen` references. Findings are quality/redundancy only.

---

## P2 - Important

### [ARCH-1] Add-agent action duplicated across `+` button, kebab menu, and createWorkspace
**File:** `renderer/sidebar.js:349,351` (projects) and `:366,368,444` (workspaces)
**Confidence:** 70
**Severity:** P2
**Issue:** The `+` button's `onAddAgent` closure is a literal duplicate of the kebab menu's first action. Projects: `() => newAgent(p)` at both 349 and 351. Workspaces: `() => spawn(w.dir, w.dir, null, true)` at 366, 368, and again in `createWorkspace()` at 444. A future change (extra arg, confirm step, error handling) must be kept in sync manually across 2–3 sites per section — shotgun surgery.
**Fix:** Hoist one local per section and reference from both entry points, e.g. `const addAgent = () => newAgent(p);` used by `onAddAgent` and the kebab `action`; same for the workspace spawn (and `createWorkspace`).

---

## P3 - Nice-to-Have

### [STYLE-1] Header click guard `e.target === kebab || e.target === addBtn` is unreachable
**File:** `renderer/sidebar.js:286-289`
**Confidence:** 78
**Severity:** P3
**Issue:** `kebab` (294-297) and `addBtn` (290-293) both call `e.stopPropagation()` in their own handlers, so the bubble-phase header listener never fires for clicks on those buttons — the guard can never be true. It mirrors the same defensive pattern in `buildAgentRow:126` / `buildDormantRow:182`, so it's consistent house style (defense-in-depth), not a new bug — but it is not the mechanism that prevents double-firing.
**Fix:** Keep as intentional defensive guard (add a one-word comment), or simplify to `header.addEventListener('click', () => toggleCollapse(p.dir));`.

### [STYLE-2] Chevron's dedicated click listener is now redundant
**File:** `renderer/sidebar.js:258-261`
**Confidence:** 78
**Severity:** P3
**Issue:** The chevron has its own `click` + `stopPropagation` + `toggleCollapse(p.dir)`. Since the header click handler (285-289) now calls `toggleCollapse(p.dir)` for any non-button target (chevron included), the chevron handler produces an identical result. Leftover from when a header click did `onOpen` and the chevron needed to opt out. Harmless (no double-toggle — propagation is stopped) but dead duplicate logic.
**Fix:** Remove the chevron listener and let the click bubble to the header handler, or add a comment noting it's kept for explicitness.

### [STYLE-3] `+` button tooltip "New agent" disagrees with kebab label "Open worktree" (projects)
**File:** `renderer/sidebar.js:234` vs `:351`
**Confidence:** 65
**Severity:** P3
**Issue:** For projects the `+` button title is hardcoded `'New agent'`, but the action it triggers (`newAgent` → worktree/branch picker) is the same call the kebab labels `'Open worktree'`. Same action, two names in the same header.
**Fix:** Pass a per-section `addLabel` into `buildItemHeader` (`'Open worktree'` for projects, `'New agent'` for workspaces), or align the kebab label.

---

## Cross-Cutting Analysis

### Root Causes
| Root Cause | Findings | Suggested Fix |
|------------|----------|---------------|
| Add-agent action wired at multiple sites | ARCH-1, STYLE-3 | Single `addAgent`/`addAgentTo` fn per section + one label source |
| Leftover wiring from old `onOpen` behavior | STYLE-1, STYLE-2 | Collapse chevron+header toggle into one handler |

### Single-Fix Opportunities
1. Extract `addAgent`/`addAgentToWorkspace` per section — fixes ARCH-1 and unblocks a single tooltip/label source (STYLE-3). (~6 lines)
2. Drop redundant chevron listener + simplify header guard — fixes STYLE-1 and STYLE-2. (~4 lines removed)

### Context Files (Read Before Fixing)
| File | Reason | Referenced By |
|------|--------|---------------|
| `renderer/worktree.js` (`newAgent`) | Projects' add-agent target; picker flow | ts, arch, silent-failure |
| `renderer/agents.js` (`spawn`, `activate`) | Workspaces' add-agent target; still-live import | ts, simplicity |
| `renderer/logger.js` | Global `unhandledrejection` net for fire-and-forget clicks | silent-failure |

## Recommended Actions
1. **Immediate:** none (no P1).
2. **This change:** ARCH-1 — dedupe add-agent action.
3. **Follow-up:** STYLE-1/2/3 cleanup; optionally add local `.catch` on `addBtn` handler to surface picker-open failures (filtered C55, low probability today).

### Filtered (below threshold 70)
- **[BUG] async fire-and-forget** `sidebar.js:290-293` (C55) — `onAddAgent()` (→ async `newAgent`) unawaited/uncaught; only the global `unhandledrejection` logger catches it. Low risk: `execGit` never rejects, `spawnAgent` is try/caught. Consider `Promise.resolve(onAddAgent()).catch(...)` for parity with `createWorktreeFlow`.
- **[ARCH] parent/child click asymmetry** (C45) — header now collapses-only while agent rows still activate-on-click, no cursor/affordance change. Intentional per comment at 205-207.
