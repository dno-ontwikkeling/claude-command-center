---
id: 028-16cc
title: [TEST-1] Security-hardened editors.js has zero tests
status: complete
priority: P2
type: chore
created: "2026-07-16T22:38:16.366Z"
updated: "2026-07-16T22:48:10.916Z"
dependencies: []
completed_at: "2026-07-16T22:48:10.916Z"
---

# [TEST-1] Security-hardened editors.js has zero tests

## Problem Statement

editors.js documents a real previously-fixed command-injection (branch-derived path to cmd.exe) and implements mitigations (quote rejection, windowsVerbatimArguments + manual quoting). No test guards it - a simplifying refactor could silently reintroduce the injection (conf95).

## Acceptance Criteria

- [x] Test: openInVSCode rejects cwd containing a double-quote
- [x] Test: builds expected verbatim command line for paths with & | and spaces
- [x] Test: resolveVSCode caching does not re-invoke where/which
- [x] Test: openInVisualStudio non-win32 returns error without fs touch; single .sln vs folder-open fallback

## Files

- editors.js
- test/editors.test.js

## Work Log

### 2026-07-16T22:48:10.686Z - Wave 1: implemented; 62 tests + typecheck green

