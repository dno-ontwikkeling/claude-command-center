---
id: 010-67f9
title: "docs: real-app verification + README/PRODUCT/DESIGN updates"
status: pending
priority: P2
type: chore
created: "2026-10-05T17:44:21.901Z"
updated: "2026-10-05T17:45:03.054Z"
dependencies: ["008-65d7", "009-742e"]
plan: plans/docs-management.md
plan_step: Step 10
depends_on: ["stories/008-65d7-pending-P2-docs-panel-header-actions-menu-busy-guard-remember.md", "stories/009-742e-pending-P2-docs-folders-overlay-to-edit-per-project-doc-folde.md"]
---

# docs: real-app verification + README/PRODUCT/DESIGN updates

## Problem Statement

The docs-management feature needs an end-to-end check in the running app and user-facing docs updated to describe it.

## Acceptance Criteria

- [ ] [MANUAL] Real app run: add docs and . via Folders..., archive/restore/clash/trash (Recycle Bin), open in editor, reveal, a worktree agent of the same project shares the folders, forgetting the project leaves no docFolders behind and re-adding starts on defaults
- [ ] README.md, PRODUCT.md and DESIGN.md updated to describe the kebab menu, Archived group, and Folders overlay
- [ ] VERIFY: npm test

## Files

- README.md
- PRODUCT.md
- DESIGN.md

## Proof

- [ ] [completeness] Completeness
- [ ] [feature-availability] Feature availability
- [ ] [robustness] Robustness
- [ ] [resilience] Resilience
- [ ] [security] Security
- [ ] [defense-in-depth] Defense in depth
- [ ] [input-validation] Input validation
- [ ] [thread-safety] Thread safety
- [ ] [configurability] Configurability

## Work Log

