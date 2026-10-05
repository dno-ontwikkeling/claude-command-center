---
id: 002-4e09
title: "docs: docFoldersFor/withDocFolders record helpers + cleanup contract"
status: pending
priority: P2
type: feature
created: "2026-10-05T17:44:21.887Z"
updated: "2026-10-05T17:44:43.516Z"
dependencies: ["001-addf"]
plan: plans/docs-management.md
plan_step: Step 2
depends_on: ["stories/001-addf-pending-P2-docs-normalizefolders-validates-and-normalizes-fol.md"]
---

# docs: docFoldersFor/withDocFolders record helpers + cleanup contract

## Problem Statement

Folder config lives on project/workspace records; it must default safely, survive corruption, and disappear automatically when a project is removed.

## Acceptance Criteria

- [ ] docFoldersFor: missing field -> defaults; corrupt field -> defaults + invalid:true; dir matches across case/separators on win32
- [ ] withDocFolders: updates only the matching record, leaves input array untouched, removing docFolders when set to defaults; unknown dir -> ok:false
- [ ] Cleanup: after filtering the record out of the list, docFoldersFor returns defaults; re-adding the record starts clean (same for a workspace-shaped record)
- [ ] VERIFY: node --test test/docs.test.js

## Files

- docs.js
- test/docs.test.js

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

