---
id: 002-4e09
title: "docs: docFoldersFor/withDocFolders record helpers + cleanup contract"
status: complete
priority: P2
type: feature
created: "2026-10-05T17:44:21.887Z"
updated: "2026-10-05T17:49:32.529Z"
dependencies: ["001-addf"]
plan: plans/docs-management.md
plan_step: Step 2
depends_on: ["stories/001-addf-pending-P2-docs-normalizefolders-validates-and-normalizes-fol.md"]
started_at: "2026-10-05T17:48:07.279Z"
completed_at: "2026-10-05T17:49:32.528Z"
---

# docs: docFoldersFor/withDocFolders record helpers + cleanup contract

## Problem Statement

Folder config lives on project/workspace records; it must default safely, survive corruption, and disappear automatically when a project is removed.

## Acceptance Criteria

- [x] docFoldersFor: missing field -> defaults; corrupt field -> defaults + invalid:true; dir matches across case/separators on win32
- [x] withDocFolders: updates only the matching record, leaves input array untouched, removing docFolders when set to defaults; unknown dir -> ok:false
- [x] Cleanup: after filtering the record out of the list, docFoldersFor returns defaults; re-adding the record starts clean
- [x] VERIFY: node --test test/docs.test.js

## Files

- docs.js
- test/docs.test.js

## Proof

- [x] [completeness] Completeness (test/docs.test.js: 9 docFoldersFor/withDocFolders/cleanup tests, 32/32 pass)
- [~] [feature-availability] Feature availability (Pure helpers; wired into IPC by story 007)
- [x] [robustness] Robustness (corrupt docFolders （../.., string, number, archive） fall back to defaults with invalid:true; samePath returns false for non-string dirs)
- [x] [resilience] Resilience (cleanup tests: removing the record （projects:remove filter） leaves no docFolders; re-adding starts on defaults; workspace record same)
- [x] [security] Security (docFoldersFor re-runs normalizeFolders on every read, so a hand-edited ../.. in projects.json cannot reach the fs （test 'corrupt stored list falls back'）)
- [x] [defense-in-depth] Defense in depth (read-time re-validation is the second layer after write-time normalizeFolders; realpath guard follows in story 004)
- [x] [input-validation] Input validation (withDocFolders rejects an unknown dir （test 'an unknown dir is an error'）; dir matching across separators/case tested)
- [~] [thread-safety] Thread safety (Pure functions returning new arrays; input untouched （tested）. Store writes stay in main.js persistStore （atomic）)
- [x] [configurability] Configurability (per-project docFolders on the record; saving defaults removes the field （test 'saving the defaults removes the field'）)

## QA

None — covered by tests

## Work Log


### 2026-10-05T17:49:07.063Z - Proof completeness set PROVEN: test/docs.test.js: 9 docFoldersFor/withDocFolders/cleanup tests, 32/32 pass

### 2026-10-05T17:49:08.619Z - Proof feature-availability set NOT_APPLICABLE: Pure helpers; wired into IPC by story 007

### 2026-10-05T17:49:10.143Z - Proof robustness set PROVEN: corrupt docFolders (../.., string, number, archive) fall back to defaults with invalid:true; samePath returns false for non-string dirs

### 2026-10-05T17:49:11.592Z - Proof resilience set PROVEN: cleanup tests: removing the record (projects:remove filter) leaves no docFolders; re-adding starts on defaults; workspace record same

### 2026-10-05T17:49:13.194Z - Proof security set PROVEN: docFoldersFor re-runs normalizeFolders on every read, so a hand-edited ../.. in projects.json cannot reach the fs (test 'corrupt stored list falls back')

### 2026-10-05T17:49:14.796Z - Proof defense-in-depth set PROVEN: read-time re-validation is the second layer after write-time normalizeFolders; realpath guard follows in story 004

### 2026-10-05T17:49:16.267Z - Proof input-validation set PROVEN: withDocFolders rejects an unknown dir (test 'an unknown dir is an error'); dir matching across separators/case tested

### 2026-10-05T17:49:17.735Z - Proof thread-safety set NOT_APPLICABLE: Pure functions returning new arrays; input untouched (tested). Store writes stay in main.js persistStore (atomic)

### 2026-10-05T17:49:19.250Z - Proof configurability set PROVEN: per-project docFolders on the record; saving defaults removes the field (test 'saving the defaults removes the field')

### 2026-10-05T17:49:22.973Z - Completed: samePath, docFoldersFor, withDocFolders in docs.js. RED: 9 tests 'is not a function'. GREEN: node --test test/docs.test.js 32/32; typecheck clean.

