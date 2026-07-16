---
id: 026-08ba
title: [PERF-2] Synchronous fs.rmSync in worktree delete blocks main thread
status: ready
priority: P2
type: fix
created: "2026-07-16T22:38:16.365Z"
updated: "2026-07-16T22:38:40.965Z"
dependencies: []
---

# [PERF-2] Synchronous fs.rmSync in worktree delete blocks main thread

## Problem Statement

rmDirRetry (main.js:433-444) uses fs.rmSync(target,{recursive,force}) on the main process single thread. Deleting a worktree with a large node_modules/bin/obj tree freezes every other agent PTY pump and all pending IPC for the duration (conf65).

## Acceptance Criteria

- [ ] Replace fs.rmSync with async fs.promises.rm
- [ ] Keep the retry loop, await the async call

## Files

- main.js

## Work Log

