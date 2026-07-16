---
id: 021-f40e
title: [TYPE-1] IPC type contract drifted from runtime in 5 handlers
status: complete
priority: P2
type: fix
created: "2026-07-16T22:38:16.359Z"
updated: "2026-07-16T22:48:08.616Z"
dependencies: []
completed_at: "2026-07-16T22:48:08.615Z"
---

# [TYPE-1] IPC type contract drifted from runtime in 5 handlers

## Problem Statement

types/ipc.d.ts declares shapes that no longer match main.js; renderer follows the real shape so the .d.ts is stale (conf95, three reviewers traced to consumers). Drifted: listBranches, createWorktree, gitDiff/DiffResult, onExit, onEvent (missing event field agents.js:534 branches on).

## Acceptance Criteria

- [x] Rewrite the 5 declarations in types/ipc.d.ts to match shapes renderer consumers rely on
- [x] Fix spawn/open-external declared Promise<OpResult> vs actual void
- [x] Replace opts:object on createWorktree/spawn with concrete interfaces

## Files

- types/ipc.d.ts
- main.js

## Work Log

### 2026-07-16T22:48:08.387Z - Wave 1: implemented; 62 tests + typecheck green

