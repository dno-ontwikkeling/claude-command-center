---
id: 006-a3bc
title: [PERF-3] Sync recursive detectProjectType on every list call
status: ready
priority: P1
type: refactor
created: "2026-07-16T20:25:27.201Z"
updated: "2026-07-16T20:26:42.919Z"
dependencies: []
tags: ["review", "PERF-3"]
---

# [PERF-3] Sync recursive detectProjectType on every list call

## Problem Statement

detectProjectType does a depth-3 fs.readdirSync recursion per project AND workspace on every projects:list/workspaces:list (incl. 15s auto-refresh), blocking the event loop that also forwards PTY onData/onExit. Project type never changes at runtime.

## Acceptance Criteria

- [ ] Cache detectProjectType result per dir
- [ ] Invalidate cache on project/workspace add/remove
- [ ] Lowercase-compare PTYPE_SKIP_DIRS so cased dir names are skipped

## Files

- main.js

## Work Log

### 2026-07-16T20:26:43.151Z - Source: reviews/review-2026-07-16-full-app.md finding [PERF-3]

