---
id: 015-1521
title: [BUG-3] confirmDialog/promptText not reentrant
status: complete
priority: P2
type: fix
created: "2026-07-16T20:25:27.209Z"
updated: "2026-07-16T20:38:17.112Z"
dependencies: []
tags: ["review", "BUG-3"]
completed_at: "2026-07-16T20:38:17.111Z"
---

# [BUG-3] confirmDialog/promptText not reentrant

## Problem Statement

Singleton overlay wired via onclick=. Two programmatic calls before the first resolves overwrite handlers on the same nodes; the first Promise never resolves and its await stalls forever.

## Acceptance Criteria

- [x] Queue concurrent modal requests or guard callers so only one is pending
- [x] First caller's Promise always resolves

## Files

- renderer/modals.js

## Work Log

### 2026-07-16T20:26:42.687Z - Source: reviews/review-2026-07-16-full-app.md finding [BUG-3]

### 2026-07-16T20:38:16.877Z - Wave 1: implemented + node --check passed

