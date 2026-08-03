---
id: 012-ba67
title: [DATA-6] Session purged when worktree removal aborted/fails
status: complete
priority: P2
type: fix
created: "2026-07-16T20:25:27.206Z"
updated: "2026-07-16T20:38:14.754Z"
dependencies: []
tags: ["review", "DATA-6"]
completed_at: "2026-07-16T20:38:14.753Z"
---

# [DATA-6] Session purged when worktree removal aborted/fails

## Problem Statement

deleteWorktree kills the pty (killAndWait) before git worktree remove, then runs cleanupAgent unconditionally (dormant.delete, persistAgents). If removal fails and user declines force, the app forgets the session while worktree+branch persist — no UI path back.

## Acceptance Criteria

- [x] Kill pty only after removal (incl. force decision) is confirmed
- [x] Or restore the dormant record when removal is aborted/fails
- [x] Verify a failed removal leaves a resumable session in the UI

## Files

- renderer/agents.js

## Work Log

### 2026-07-16T20:26:40.805Z - Source: reviews/review-2026-07-16-full-app.md finding [DATA-6]

### 2026-07-16T20:38:14.518Z - Wave 1: implemented + node --check passed

