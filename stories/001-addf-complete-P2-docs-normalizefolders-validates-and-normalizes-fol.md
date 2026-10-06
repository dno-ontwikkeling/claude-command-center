---
id: 001-addf
title: "docs: normalizeFolders validates and normalizes folder config"
status: complete
priority: P2
type: feature
created: "2026-10-05T17:44:21.831Z"
updated: "2026-10-05T17:47:56.776Z"
dependencies: []
plan: plans/docs-management.md
plan_step: Step 1
started_at: "2026-10-05T17:46:49.913Z"
completed_at: "2026-10-05T17:47:56.776Z"
---

# docs: normalizeFolders validates and normalizes folder config

## Problem Statement

The docs panel needs a per-project folder list; raw user/record input must be validated before it ever reaches the filesystem guard.

## Acceptance Criteria

- [x] Accepts plans, docs/api, . ; normalizes a backslash form like docs\api to docs/api and '' to .
- [x] Rejects .., a/../b, a drive-letter path, an absolute path, a UNC share, a null byte, archive, plans/archive
- [x] Case-insensitive dedupe; caps at 20 entries with an error; [] and non-array handled
- [x] VERIFY: node --test test/docs.test.js

## Files

- docs.js
- test/docs.test.js

## Proof

- [x] [completeness] Completeness (test/docs.test.js normalizeFolders: 8 tests cover accept, normalize, reject, archive, dedupe, cap, defaults, non-array （23/23 pass）)
- [~] [feature-availability] Feature availability (Pure helper; exposed to users only once wired in story 007 （IPC） and 009 （overlay）)
- [x] [robustness] Robustness (never throws: non-array, null, object, number and null entries return ok:false （test 'rejects non-arrays and non-string entries'）)
- [~] [resilience] Resilience (No I/O or external dependency; pure synchronous validation)
- [x] [security] Security (test 'rejects anything that leaves the project': .., a/../b, ../x, plans/./x, C:\x, c:x, /abs, UNC, null byte, a//b all ok:false)
- [~] [defense-in-depth] Defense in depth (First layer only; realpath containment guard is story 004 （resolveDoc）, re-validation on read is story 002)
- [x] [input-validation] Input validation (test/docs.test.js normalizeFolders: separator/trailing-slash/./blank normalization, archive rejection, case-insensitive dedupe, 20-entry cap)
- [~] [thread-safety] Thread safety (Pure function, no shared state; DEFAULT_FOLDERS frozen and returned as a copy （tested）)
- [x] [configurability] Configurability (DEFAULT_FOLDERS and MAX_FOLDERS are module constants; empty list maps to defaults （test 'empty list means the defaults'）)

## QA

None — covered by tests

## Work Log


### 2026-10-05T17:47:27.641Z - Proof completeness set PROVEN: test/docs.test.js normalizeFolders: 8 tests cover accept, normalize, reject, archive, dedupe, cap, defaults, non-array (23/23 pass)

### 2026-10-05T17:47:29.198Z - Proof feature-availability set NOT_APPLICABLE: Pure helper; exposed to users only once wired in story 007 (IPC) and 009 (overlay)

### 2026-10-05T17:47:30.738Z - Proof robustness set PROVEN: never throws: non-array, null, object, number and null entries return ok:false (test 'rejects non-arrays and non-string entries')

### 2026-10-05T17:47:32.309Z - Proof resilience set NOT_APPLICABLE: No I/O or external dependency; pure synchronous validation

### 2026-10-05T17:47:33.992Z - Proof security set PROVEN: test 'rejects anything that leaves the project': .., a/../b, ../x, plans/./x, C:\x, c:x, /abs, UNC, null byte, a//b all ok:false

### 2026-10-05T17:47:35.630Z - Proof defense-in-depth set NOT_APPLICABLE: First layer only; realpath containment guard is story 004 (resolveDoc), re-validation on read is story 002

### 2026-10-05T17:47:37.183Z - Proof input-validation set PROVEN: test/docs.test.js normalizeFolders: separator/trailing-slash/./blank normalization, archive rejection, case-insensitive dedupe, 20-entry cap

### 2026-10-05T17:47:38.680Z - Proof thread-safety set NOT_APPLICABLE: Pure function, no shared state; DEFAULT_FOLDERS frozen and returned as a copy (tested)

### 2026-10-05T17:47:40.178Z - Proof configurability set PROVEN: DEFAULT_FOLDERS and MAX_FOLDERS are module constants; empty list maps to defaults (test 'empty list means the defaults')

### 2026-10-05T17:47:43.828Z - Completed: normalizeFolders + DEFAULT_FOLDERS (frozen) in docs.js. RED: TypeError normalizeFolders is not a function. GREEN: node --test test/docs.test.js 23/23.

