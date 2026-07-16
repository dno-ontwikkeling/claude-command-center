---
id: 016-5871
title: "[BUG-4] agent:input lacks dead-pty guard"
status: ready
priority: P2
type: fix
created: "2026-07-16T20:25:27.209Z"
updated: "2026-07-16T20:26:41.482Z"
dependencies: []
tags: ["review", "BUG-4"]
---

# [BUG-4] agent:input lacks dead-pty guard

## Problem Statement

agent:resize is try/caught for a dead pty but agent:input's write on the same object in the same race window (keystroke as onExit fires) can throw. Being ipcMain.on, an uncaught throw becomes a main-process uncaught exception.

## Acceptance Criteria

- [ ] Wrap agent:input write in the same try/catch guard as agent:resize

## Files

- main.js

## Work Log

### 2026-07-16T20:26:41.715Z - Source: reviews/review-2026-07-16-full-app.md finding [BUG-4]

