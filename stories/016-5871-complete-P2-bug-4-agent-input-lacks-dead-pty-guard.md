---
id: 016-5871
title: "[BUG-4] agent:input lacks dead-pty guard"
status: complete
priority: P2
type: fix
created: "2026-07-16T20:25:27.209Z"
updated: "2026-07-16T20:48:13.871Z"
dependencies: []
tags: ["review", "BUG-4"]
completed_at: "2026-07-16T20:48:13.870Z"
---

# [BUG-4] agent:input lacks dead-pty guard

## Problem Statement

agent:resize is try/caught for a dead pty but agent:input's write on the same object in the same race window (keystroke as onExit fires) can throw. Being ipcMain.on, an uncaught throw becomes a main-process uncaught exception.

## Acceptance Criteria

- [x] Wrap agent:input write in the same try/catch guard as agent:resize

## Files

- main.js

## Work Log

### 2026-07-16T20:26:41.715Z - Source: reviews/review-2026-07-16-full-app.md finding [BUG-4]

### 2026-07-16T20:48:13.630Z - Wave 3: implemented + node --check passed

