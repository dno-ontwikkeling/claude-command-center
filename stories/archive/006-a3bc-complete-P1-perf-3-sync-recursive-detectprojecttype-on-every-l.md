---
id: 006-a3bc
title: [PERF-3] Sync recursive detectProjectType on every list call
status: complete
priority: P1
type: refactor
created: "2026-07-16T20:25:27.201Z"
updated: "2026-07-16T20:48:13.064Z"
dependencies: []
tags: ["review", "PERF-3"]
completed_at: "2026-07-16T20:48:13.063Z"
---

# [PERF-3] Sync recursive detectProjectType on every list call

## Problem Statement

detectProjectType does a depth-3 fs.readdirSync recursion per project AND workspace on every projects:list/workspaces:list (incl. 15s auto-refresh), blocking the event loop that also forwards PTY onData/onExit. Project type never changes at runtime.

## Acceptance Criteria

- [x] Cache detectProjectType result per dir
- [x] Invalidate cache on project/workspace add/remove
- [x] Lowercase-compare PTYPE_SKIP_DIRS so cased dir names are skipped

## Files

- main.js

## Work Log

### 2026-07-16T20:26:43.151Z - Source: reviews/review-2026-07-16-full-app.md finding [PERF-3]

### 2026-07-16T20:48:12.835Z - Wave 3: implemented + node --check passed

