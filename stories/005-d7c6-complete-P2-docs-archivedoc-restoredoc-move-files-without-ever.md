---
id: 005-d7c6
title: "docs: archiveDoc/restoreDoc move files without ever overwriting"
status: complete
priority: P2
type: feature
created: "2026-10-05T17:44:21.892Z"
updated: "2026-10-05T17:54:25.977Z"
dependencies: ["004-56f8"]
plan: plans/docs-management.md
plan_step: Step 5
depends_on: ["stories/004-56f8-pending-P2-docs-resolvedoc-path-guard-readdoc-cwd-folders-rel.md"]
started_at: "2026-10-05T17:53:00.323Z"
completed_at: "2026-10-05T17:54:25.977Z"
---

# docs: archiveDoc/restoreDoc move files without ever overwriting

## Problem Statement

Users need to archive and restore docs from the panel; a name clash must never silently destroy a file.

## Acceptance Criteria

- [x] archive moves plans/a.md to plans/archive/a.md, creates archive/ if missing, returns the new rel
- [x] A name clash picks a free name (a (2).md, then a (3).md) and the original files' content is untouched; restore mirrors the same clash rule
- [x] Archiving an already-archived doc, or restoring a non-archived doc, returns ok:false; a missing file returns ok:false without throwing; the root folder '.' works the same way
- [x] VERIFY: node --test test/docs.test.js

## Files

- docs.js
- test/docs.test.js

## Proof

- [x] [completeness] Completeness (test/docs.test.js: 7 archive/restore tests （move+mkdir, clash （2）/（3）, restore clash, wrong direction, missing/guarded, root '.', archive junction）; npm test 316/316)
- [~] [feature-availability] Feature availability (Exposed via docs:action in story 007 and the header menu in story 008)
- [x] [robustness] Robustness (never throws （doesNotReject on missing, ../, unconfigured）; wrong-direction calls leave both files intact （tests）)
- [x] [resilience] Resilience (no copy+delete fallback: a failed rename returns ok:false with the file untouched; refused archive junction leaves plans/a.md in place （test）)
- [x] [security] Security (source via resolveDoc; destination archive/ realpath must sit inside the folder — mutation test: removing that check makes 'archive/ that links outside' fail)
- [x] [defense-in-depth] Defense in depth (rel guard + source realpath （resolveDoc） + destination realpath check + lstat-based freeName so a dangling link counts as taken)
- [x] [input-validation] Input validation (all rel validation reused from resolveDoc; direction mismatch rejected （test 'refuse the wrong direction'）)
- [~] [thread-safety] Thread safety (Single-user app; free-name pick runs right before rename （accepted TOCTOU documented in plan Research Findings）)
- [x] [configurability] Configurability (works for any configured folder incl. '.' （README.md <-> archive/README.md test）)

## QA

None — covered by tests

## Work Log


### 2026-10-05T17:53:58.853Z - Proof completeness set PROVEN: test/docs.test.js: 7 archive/restore tests (move+mkdir, clash (2)/(3), restore clash, wrong direction, missing/guarded, root '.', archive junction); npm test 316/316

### 2026-10-05T17:54:00.447Z - Proof feature-availability set NOT_APPLICABLE: Exposed via docs:action in story 007 and the header menu in story 008

### 2026-10-05T17:54:01.923Z - Proof robustness set PROVEN: never throws (doesNotReject on missing, ../, unconfigured); wrong-direction calls leave both files intact (tests)

### 2026-10-05T17:54:03.923Z - Proof resilience set PROVEN: no copy+delete fallback: a failed rename returns ok:false with the file untouched; refused archive junction leaves plans/a.md in place (test)

### 2026-10-05T17:54:05.552Z - Proof security set PROVEN: source via resolveDoc; destination archive/ realpath must sit inside the folder — mutation test: removing that check makes 'archive/ that links outside' fail

### 2026-10-05T17:54:07.067Z - Proof defense-in-depth set PROVEN: rel guard + source realpath (resolveDoc) + destination realpath check + lstat-based freeName so a dangling link counts as taken

### 2026-10-05T17:54:08.699Z - Proof input-validation set PROVEN: all rel validation reused from resolveDoc; direction mismatch rejected (test 'refuse the wrong direction')

### 2026-10-05T17:54:10.399Z - Proof thread-safety set NOT_APPLICABLE: Single-user app; free-name pick runs right before rename (accepted TOCTOU documented in plan Research Findings)

### 2026-10-05T17:54:11.994Z - Proof configurability set PROVEN: works for any configured folder incl. '.' (README.md <-> archive/README.md test)

### 2026-10-05T17:54:13.694Z - Completed: freeName (lstat), moveDoc, archiveDoc/restoreDoc. RED: 6 not-a-function. GREEN 49/49. Added beyond plan: destination archive/ realpath must sit inside the folder (junction escape); test added, mutation-checked (fails without the guard). npm test 316/316, typecheck clean.

