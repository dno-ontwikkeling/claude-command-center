---
id: 010-67f9
title: "docs: real-app verification + README/PRODUCT/DESIGN updates"
status: complete
priority: P2
type: chore
created: "2026-10-05T17:44:21.901Z"
updated: "2026-10-05T18:21:27.683Z"
dependencies: ["008-65d7", "009-742e"]
plan: plans/docs-management.md
plan_step: Step 10
depends_on: ["stories/008-65d7-pending-P2-docs-panel-header-actions-menu-busy-guard-remember.md", "stories/009-742e-pending-P2-docs-folders-overlay-to-edit-per-project-doc-folde.md"]
started_at: "2026-10-05T18:03:37.829Z"
completed_at: "2026-10-05T18:21:27.683Z"
---

# docs: real-app verification + README/PRODUCT/DESIGN updates

## Problem Statement

The docs-management feature needs an end-to-end check in the running app and user-facing docs updated to describe it.

## Acceptance Criteria

- [x] [MANUAL] Real app run: add docs and . via Folders..., archive/restore/clash/trash (Recycle Bin), open in editor, reveal, a worktree agent of the same project shares the folders, forgetting the project leaves no docFolders behind and re-adding starts on defaults
- [x] README.md, PRODUCT.md and DESIGN.md updated to describe the kebab menu, Archived group, and Folders overlay
- [x] VERIFY: npm test

## Files

- README.md
- PRODUCT.md
- DESIGN.md

## Proof

- [x] [completeness] Completeness (plan Log Step 10: every listed check run in the real app over CDP; README/PRODUCT/DESIGN updated; npm test 325/325, typecheck clean)
- [x] [feature-availability] Feature availability (real app: Docs panel ⋮ menu, Folders overlay, Archived groups, archive/restore/trash/open/reveal all exercised; screenshots 01-12 in both themes)
- [x] [robustness] Robustness (rejected saves （plans/archive, ../.., unknown dir） return errors in the real app; Cancel saves nothing （projects.json unchanged）)
- [x] [resilience] Resilience (archive clash produced 'a （2）.md' with the existing archive/a.md untouched; trashed file found in the Recycle Bin with its original folder)
- [x] [security] Security (trash confirm opened with Cancel focused; main.log lines carry relative paths only （docs archive plans/a.md ... docs reveal README.md）)
- [~] [defense-in-depth] Defense in depth (Verification story; layers proven in 001-007)
- [~] [input-validation] Input validation (Verification story; validation proven in 001/007 and re-observed in the real app)
- [~] [thread-safety] Thread safety (Verification story)
- [x] [configurability] Configurability (worktree agent used the project's folders; Forget project -> projects.json []; re-added record -> default Plans/Reviews only)

## QA

- [ ] Add folder via the native folder picker on a real project (CDP could not drive the OS dialog)
- [ ] Re-add a forgotten project via the dashboard and confirm default folders

## Work Log


### 2026-10-05T18:21:07.933Z - Proof completeness set PROVEN: plan Log Step 10: every listed check run in the real app over CDP; README/PRODUCT/DESIGN updated; npm test 325/325, typecheck clean

### 2026-10-05T18:21:09.581Z - Proof feature-availability set PROVEN: real app: Docs panel ⋮ menu, Folders overlay, Archived groups, archive/restore/trash/open/reveal all exercised; screenshots 01-12 in both themes

### 2026-10-05T18:21:11.145Z - Proof robustness set PROVEN: rejected saves (plans/archive, ../.., unknown dir) return errors in the real app; Cancel saves nothing (projects.json unchanged)

### 2026-10-05T18:21:12.738Z - Proof resilience set PROVEN: archive clash produced 'a (2).md' with the existing archive/a.md untouched; trashed file found in the Recycle Bin with its original folder

### 2026-10-05T18:21:14.543Z - Proof security set PROVEN: trash confirm opened with Cancel focused; main.log lines carry relative paths only (docs archive plans/a.md ... docs reveal README.md)

### 2026-10-05T18:21:16.232Z - Proof defense-in-depth set NOT_APPLICABLE: Verification story; layers proven in 001-007

### 2026-10-05T18:21:17.715Z - Proof input-validation set NOT_APPLICABLE: Verification story; validation proven in 001/007 and re-observed in the real app

### 2026-10-05T18:21:19.305Z - Proof thread-safety set NOT_APPLICABLE: Verification story

### 2026-10-05T18:21:20.877Z - Proof configurability set PROVEN: worktree agent used the project's folders; Forget project -> projects.json []; re-added record -> default Plans/Reviews only

### 2026-10-05T18:21:22.355Z - Completed: real-app run over CDP (scripts/e2e-docs/, isolated profile, throwaway HOME, fixture repo + worktree) — all checks passed, see plan Log Step 10. Fixed during run: #df-add icon stacked above label (.btn-ghost not flex). Also verifies the deferred [VISUAL] criteria of 008/009 (screenshots 01-12, light and dark). Not proven (plan 'Not proven'): native folder picker and re-add dialog (CDP cannot drive OS dialogs), poll on a hidden window, provoked trash/rename failure, workspace in the real app. README/PRODUCT/DESIGN updated. npm test 325/325, typecheck clean.

