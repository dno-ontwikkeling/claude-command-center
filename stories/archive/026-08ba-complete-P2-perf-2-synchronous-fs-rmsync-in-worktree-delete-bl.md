---
id: 026-08ba
title: [PERF-2] Synchronous fs.rmSync in worktree delete blocks main thread
status: complete
priority: P2
type: fix
created: "2026-07-16T22:38:16.365Z"
updated: "2026-07-16T22:48:10.152Z"
dependencies: []
completed_at: "2026-07-16T22:48:10.152Z"
---

# [PERF-2] Synchronous fs.rmSync in worktree delete blocks main thread

## Problem Statement

rmDirRetry (main.js:433-444) uses fs.rmSync(target,{recursive,force}) on the main process single thread. Deleting a worktree with a large node_modules/bin/obj tree freezes every other agent PTY pump and all pending IPC for the duration (conf65).

## Acceptance Criteria

- [x] Replace fs.rmSync with async fs.promises.rm
- [x] Keep the retry loop, await the async call

## Files

- main.js

## Work Log

### 2026-07-16T22:48:09.918Z - Wave 1: implemented; 62 tests + typecheck green

