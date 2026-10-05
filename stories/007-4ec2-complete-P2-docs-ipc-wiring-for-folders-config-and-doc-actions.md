---
id: 007-4ec2
title: "docs: IPC wiring for folders config and doc actions"
status: complete
priority: P2
type: feature
created: "2026-10-05T17:44:21.896Z"
updated: "2026-10-05T17:58:55.410Z"
dependencies: ["005-d7c6"]
plan: plans/docs-management.md
plan_step: Step 7
depends_on: ["stories/005-d7c6-pending-P2-docs-archivedoc-restoredoc-move-files-without-ever.md"]
started_at: "2026-10-05T17:56:01.611Z"
completed_at: "2026-10-05T17:58:55.409Z"
---

# docs: IPC wiring for folders config and doc actions

## Problem Statement

The renderer needs IPC handlers to list/read docs with per-project folders, save folder config, and run archive/restore/trash/open/reveal, all gated on known directories.

## Acceptance Criteria

- [x] docs:list {cwd,dir} returns {folders, docs}; docs:read {cwd,dir,rel} uses the project's configured folders; both reject an unknown cwd
- [x] docs:folders-set {dir,folders} normalizes then saves onto the matching project or workspace record, or returns 'Unknown project'
- [x] docs:action {cwd,dir,rel,action} handles archive/restore/open/reveal/trash, each going through resolveDoc first; trash uses shell.trashItem with no permanent-delete fallback; docs:pick-folder clamps the native picker inside cwd
- [x] types/ipc.d.ts updated
- [x] VERIFY: npm run typecheck

## Files

- main.js
- preload.js
- types/ipc.d.ts

## Proof

- [x] [completeness] Completeness (main.js docs:list/read/folders-set/pick-folder/action, preload + ipc.d.ts; dispatch moved to docs.docAction with 5 unit tests; npm test 325/325, typecheck clean, node --check main.js ok)
- [x] [feature-availability] Feature availability (docs-panel.js now calls listDocs（cwd, dir） -> {folders, docs} and readDoc（cwd, dir, rel）, so stored docFolders reach the panel; UI to set them is story 009)
- [x] [robustness] Robustness (docFoldersForDir catches a corrupt store -> defaults; folders-set catches load/save throws -> ok:false; renderer validates the docs:list shape （isDocList） before use)
- [x] [resilience] Resilience (test 'a failed trash reports and leaves the file （no permanent delete）'; editor error passed through （test）)
- [x] [security] Security (every handler gates isKnownDir（cwd）; dir is only a lookup key; test 'unknown actions and guarded paths never reach the OS' （no trash/reveal/open call for ../secret.md, secret.md, unknown action）; pick-folder rejects paths outside cwd)
- [x] [defense-in-depth] Defense in depth (isKnownDir gate -> stored folders re-validated （docFoldersFor） -> resolveDoc realpath guard -> OS call receives only the resolved real path)
- [x] [input-validation] Input validation (folders-set runs normalizeFolders before any write; unknown dir -> 'Unknown project'; unknown/undefined action rejected （test）)
- [~] [thread-safety] Thread safety (IPC handlers run on main's single thread; store writes use the existing atomic persistStore)
- [x] [configurability] Configurability (docs:folders-set writes per-project/workspace docFolders; docs:list returns them in display order; log lines carry rel only and quoted fs paths are redacted)

## QA

None — dispatch unit-tested; handlers exercised in the story 010 real-app run

## Work Log


### 2026-10-05T17:58:27.483Z - Proof completeness set PROVEN: main.js docs:list/read/folders-set/pick-folder/action, preload + ipc.d.ts; dispatch moved to docs.docAction with 5 unit tests; npm test 325/325, typecheck clean, node --check main.js ok

### 2026-10-05T17:58:29.106Z - Proof feature-availability set PROVEN: docs-panel.js now calls listDocs(cwd, dir) -> {folders, docs} and readDoc(cwd, dir, rel), so stored docFolders reach the panel; UI to set them is story 009

### 2026-10-05T17:58:30.802Z - Proof robustness set PROVEN: docFoldersForDir catches a corrupt store -> defaults; folders-set catches load/save throws -> ok:false; renderer validates the docs:list shape (isDocList) before use

### 2026-10-05T17:58:32.365Z - Proof resilience set PROVEN: test 'a failed trash reports and leaves the file (no permanent delete)'; editor error passed through (test)

### 2026-10-05T17:58:34.017Z - Proof security set PROVEN: every handler gates isKnownDir(cwd); dir is only a lookup key; test 'unknown actions and guarded paths never reach the OS' (no trash/reveal/open call for ../secret.md, secret.md, unknown action); pick-folder rejects paths outside cwd

### 2026-10-05T17:58:35.637Z - Proof defense-in-depth set PROVEN: isKnownDir gate -> stored folders re-validated (docFoldersFor) -> resolveDoc realpath guard -> OS call receives only the resolved real path

### 2026-10-05T17:58:37.367Z - Proof input-validation set PROVEN: folders-set runs normalizeFolders before any write; unknown dir -> 'Unknown project'; unknown/undefined action rejected (test)

### 2026-10-05T17:58:38.872Z - Proof thread-safety set NOT_APPLICABLE: IPC handlers run on main's single thread; store writes use the existing atomic persistStore

### 2026-10-05T17:58:40.454Z - Proof configurability set PROVEN: docs:folders-set writes per-project/workspace docFolders; docs:list returns them in display order; log lines carry rel only and quoted fs paths are redacted

### 2026-10-05T17:58:41.960Z - Completed: main.js docs:list {folders,docs}, docs:read, docs:folders-set, docs:pick-folder, docs:action (+ docFoldersForDir, DOC_OS_OPS); preload + types/ipc.d.ts; docs-panel.js passes dir and consumes {folders, docs}. Found: typecheck only covers preload.js vs ipc.d.ts, not main.js or renderer, so moved action dispatch into docs.docAction with injected OS ops and added 5 tests (RED: not a function; GREEN). Log lines redact quoted fs paths. npm test 325/325, typecheck clean, node --check main.js ok. Handlers themselves are only verified in the real-app run (story 010).

### 2026-10-05T17:59:01.420Z - Note: stories-cli VERIFY failed with 'spawnSync npm ENOENT' (CLI spawns npm without a shell on Windows; npm is npm.cmd). Tooling issue, not code: npm run typecheck run manually just before completion, clean.

