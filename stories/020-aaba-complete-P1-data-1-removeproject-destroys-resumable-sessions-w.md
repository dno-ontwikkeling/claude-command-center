---
id: 020-aaba
title: [DATA-1] removeProject destroys resumable sessions with no confirm
status: complete
priority: P1
type: fix
created: "2026-07-16T22:38:16.356Z"
updated: "2026-07-16T22:48:07.849Z"
dependencies: []
completed_at: "2026-07-16T22:48:07.849Z"
---

# [DATA-1] removeProject destroys resumable sessions with no confirm

## Problem Statement

removeProject(dir) (sidebar.js:389) has NO confirmDialog unlike removeWorkspace. It loops agentsForDir calling removeAgent->kill then unconditional cleanupAgent, never convertToDormant. Any in-progress session with sessionId/used=true is permanently discarded on one misclick. Validated conf88. Also folds DATA-2: dormant records for a removed project/workspace are never pruned and linger in localStorage forever.

## Acceptance Criteria

- [x] removeProject shows a confirmDialog before teardown
- [x] Resumable agents (sessionId+used) convert to dormant not cleanupAgent - reuse deleteWorktree preservation path
- [x] removeProject and removeWorkspace prune dormant records for the removed dir

## Files

- renderer/sidebar.js
- renderer/agents.js
- renderer/state.js

## Work Log

### 2026-07-16T22:48:07.618Z - Wave 1: implemented; 62 tests + typecheck green

