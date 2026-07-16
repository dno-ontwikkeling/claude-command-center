---
id: 011-bb16
title: "[DATA-5] worktree:remove reports success even when deletion failed"
status: ready
priority: P2
type: fix
created: "2026-07-16T20:25:27.206Z"
updated: "2026-07-16T20:26:41.943Z"
dependencies: []
tags: ["review", "DATA-5"]
---

# [DATA-5] worktree:remove reports success even when deletion failed

## Problem Statement

rmDirRetry gives up silently after 5 retries; worktree:remove unconditionally returns {ok:true}. Renderer removes the row while a locked orphan directory remains on disk.

## Acceptance Criteria

- [ ] rmDirRetry returns a success boolean
- [ ] worktree:remove threads the result so renderer can report incomplete cleanup
- [ ] User sees a message when cleanup was incomplete

## Files

- main.js
- renderer/agents.js

## Work Log

### 2026-07-16T20:26:42.174Z - Source: reviews/review-2026-07-16-full-app.md finding [DATA-5]

