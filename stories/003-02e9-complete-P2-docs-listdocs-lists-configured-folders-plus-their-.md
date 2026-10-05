---
id: 003-02e9
title: "docs: listDocs lists configured folders plus their archive/ subfolder"
status: complete
priority: P2
type: feature
created: "2026-10-05T17:44:21.889Z"
updated: "2026-10-05T17:50:56.773Z"
dependencies: ["002-4e09"]
plan: plans/docs-management.md
plan_step: Step 3
depends_on: ["stories/002-4e09-pending-P2-docs-docfoldersfor-withdocfolders-record-helpers-c.md"]
started_at: "2026-10-05T17:49:38.798Z"
completed_at: "2026-10-05T17:50:56.773Z"
---

# docs: listDocs lists configured folders plus their archive/ subfolder

## Problem Statement

The picker needs every doc across the configured folders, grouped and marked archived, without recursing into the rest of the repo.

## Acceptance Criteria

- [x] Entries are {rel, folder, archived, mtimeMs, size}; plans/archive/x.md -> archived:true, folder:'plans'
- [x] '.' lists only root files (README.md) and never node_modules or plans/a.md; root archive/old.md -> folder:'.', archived:true
- [x] Missing folder contributes nothing; nested config (docs + docs/api) lists both; default folders arg keeps today's plans/reviews behaviour; a folder over 500 files is capped at 500
- [x] VERIFY: node --test test/docs.test.js

## Files

- docs.js
- test/docs.test.js

## Proof

- [x] [completeness] Completeness (test/docs.test.js listDocs: 8 tests （shape, sort, extensions, one folder, archive/, '.' root-only, nested+missing, 500 cap）; npm test 302/302)
- [~] [feature-availability] Feature availability (Main-side helper; panel switches to folder/archived grouping in stories 006/008)
- [x] [robustness] Robustness (missing folder skipped （test 'configured folders, nested ones and missing ones'）; vanished files skipped in stat catch; subdirs ignored via Dirent.isDirectory)
- [x] [resilience] Resilience (500 per dir / 1000 total caps bound the 1 s poll （test 'caps a folder at 500 entries'）)
- [x] [security] Security (never recursive: '.' does not list node_modules/pkg/README.md or plans/a.md, archive/nested/deep.md and plans/sub/skip.md not listed （tests）)
- [~] [defense-in-depth] Defense in depth (Listing only; every read/action is re-guarded by resolveDoc in story 004)
- [~] [input-validation] Input validation (folders arrive pre-normalized from docFoldersFor （story 002）; listDocs only reads them)
- [~] [thread-safety] Thread safety (Read-only fs listing; no shared mutable state)
- [x] [configurability] Configurability (folders argument drives listing; default arg keeps plans/reviews （existing tests unchanged apart from kind->folder）)

## QA

None — covered by tests

## Work Log


### 2026-10-05T17:50:31.160Z - Proof completeness set PROVEN: test/docs.test.js listDocs: 8 tests (shape, sort, extensions, one folder, archive/, '.' root-only, nested+missing, 500 cap); npm test 302/302

### 2026-10-05T17:50:32.706Z - Proof feature-availability set NOT_APPLICABLE: Main-side helper; panel switches to folder/archived grouping in stories 006/008

### 2026-10-05T17:50:34.240Z - Proof robustness set PROVEN: missing folder skipped (test 'configured folders, nested ones and missing ones'); vanished files skipped in stat catch; subdirs ignored via Dirent.isDirectory

### 2026-10-05T17:50:35.775Z - Proof resilience set PROVEN: 500 per dir / 1000 total caps bound the 1 s poll (test 'caps a folder at 500 entries')

### 2026-10-05T17:50:37.317Z - Proof security set PROVEN: never recursive: '.' does not list node_modules/pkg/README.md or plans/a.md, archive/nested/deep.md and plans/sub/skip.md not listed (tests)

### 2026-10-05T17:50:38.751Z - Proof defense-in-depth set NOT_APPLICABLE: Listing only; every read/action is re-guarded by resolveDoc in story 004

### 2026-10-05T17:50:40.249Z - Proof input-validation set NOT_APPLICABLE: folders arrive pre-normalized from docFoldersFor (story 002); listDocs only reads them

### 2026-10-05T17:50:41.789Z - Proof thread-safety set NOT_APPLICABLE: Read-only fs listing; no shared mutable state

### 2026-10-05T17:50:43.362Z - Proof configurability set PROVEN: folders argument drives listing; default arg keeps plans/reviews (existing tests unchanged apart from kind->folder)

### 2026-10-05T17:50:44.846Z - Completed: relFor + listDocs(cwd, folders) with archive/ entries, 500/dir and 1000 total caps. RED: 6 failing (kind->folder, archive, '.', nested, cap). GREEN: docs tests 36/36, npm test 302/302, typecheck clean. Transitional: renderer still groups by kind, so the live picker is empty on this branch until 006/008.

