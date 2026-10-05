---
id: 004-56f8
title: "docs: resolveDoc path guard + readDoc(cwd, folders, rel)"
status: complete
priority: P2
type: feature
created: "2026-10-05T17:44:21.890Z"
updated: "2026-10-05T17:52:53.809Z"
dependencies: ["003-02e9"]
plan: plans/docs-management.md
plan_step: Step 4
depends_on: ["stories/003-02e9-pending-P2-docs-listdocs-lists-configured-folders-plus-their-.md"]
started_at: "2026-10-05T17:51:03.131Z"
completed_at: "2026-10-05T17:52:53.809Z"
---

# docs: resolveDoc path guard + readDoc(cwd, folders, rel)

## Problem Statement

Every read and action must go through one guard so a doc outside the configured folders, a path escape, or a symlinked folder can never be reached.

## Acceptance Criteria

- [x] Existing readDoc rejection tests (.., absolute, extension, missing file, size cap) pass with folders defaulted
- [x] README.md ok with folders:['.'], rejected with defaults; plans/sub/x.md rejected (not archive); plans/archive/x.md ok; an unconfigured folder rejected
- [x] A configured folder that is a symlink pointing outside cwd is rejected (skip on EPERM, same as the existing symlink test); a vanished file returns a 'no longer exists' error instead of throwing
- [x] VERIFY: node --test test/docs.test.js

## Files

- docs.js
- test/docs.test.js

## Proof

- [x] [completeness] Completeness (test/docs.test.js: 7 new resolveDoc/readDoc tests + existing guard tests; npm test 309/309, 0 skipped)
- [~] [feature-availability] Feature availability (Guard only; live docs:read keeps default folders （main.js:935） until story 007 passes the project's folders)
- [x] [robustness] Robustness (never throws: assertRejected uses doesNotReject; vanished file returns 'gone.md no longer exists' （test）)
- [~] [resilience] Resilience (Single fs lookup per call, no retries needed; failures surface as ok:false)
- [x] [security] Security (tests: .., backslash .., absolute, /plans, other extensions, unconfigured folder, non-archive subfolder, archive/../sub, file symlink escape and folder junction escape all rejected （symlink tests ran, 0 skipped）)
- [x] [defense-in-depth] Defense in depth (string-level rel checks, then realpath nesting cwd > folder > archive > file; folders are normalized at write （001） and re-validated at read （002）)
- [x] [input-validation] Input validation (non-string/empty rel -> 'Invalid path'; ':'/'\0'/'..' in name -> 'Invalid file name'; extension allow-list （existing tests）)
- [~] [thread-safety] Thread safety (Stateless async lookups; check-then-use window between resolve and read is the existing accepted risk （single user）)
- [x] [configurability] Configurability (folders argument selects what is reachable: README.md ok with ['.'], rejected with defaults; docs/api ok with ['docs/api'], rejected with ['docs'] （tests）)

## QA

None — covered by tests

## Work Log


### 2026-10-05T17:52:27.705Z - Proof completeness set PROVEN: test/docs.test.js: 7 new resolveDoc/readDoc tests + existing guard tests; npm test 309/309, 0 skipped

### 2026-10-05T17:52:29.206Z - Proof feature-availability set NOT_APPLICABLE: Guard only; live docs:read keeps default folders (main.js:935) until story 007 passes the project's folders

### 2026-10-05T17:52:30.728Z - Proof robustness set PROVEN: never throws: assertRejected uses doesNotReject; vanished file returns 'gone.md no longer exists' (test)

### 2026-10-05T17:52:32.317Z - Proof resilience set NOT_APPLICABLE: Single fs lookup per call, no retries needed; failures surface as ok:false

### 2026-10-05T17:52:33.927Z - Proof security set PROVEN: tests: .., backslash .., absolute, /plans, other extensions, unconfigured folder, non-archive subfolder, archive/../sub, file symlink escape and folder junction escape all rejected (symlink tests ran, 0 skipped)

### 2026-10-05T17:52:35.533Z - Proof defense-in-depth set PROVEN: string-level rel checks, then realpath nesting cwd > folder > archive > file; folders are normalized at write (001) and re-validated at read (002)

### 2026-10-05T17:52:37.034Z - Proof input-validation set PROVEN: non-string/empty rel -> 'Invalid path'; ':'/'\0'/'..' in name -> 'Invalid file name'; extension allow-list (existing tests)

### 2026-10-05T17:52:38.644Z - Proof thread-safety set NOT_APPLICABLE: Stateless async lookups; check-then-use window between resolve and read is the existing accepted risk (single user)

### 2026-10-05T17:52:40.209Z - Proof configurability set PROVEN: folders argument selects what is reachable: README.md ok with ['.'], rejected with defaults; docs/api ok with ['docs/api'], rejected with ['docs'] (tests)

### 2026-10-05T17:52:41.700Z - Completed: resolveDoc guard (realpath nesting cwd>folder>archive>file) + readDoc(cwd, folders, rel); DOC_KINDS removed; main.js docs:read call updated to the new signature (defaults until 007). RED: 9 failing. One test bug fixed: realpathSync keeps 8.3 short names, use .native. GREEN: 309/309, 0 skipped (symlink + junction escape tests ran), typecheck clean.

