---
id: 032-0e24
title: "[STYLE-5] Module splits: gitops.js, agents status engine, errMsg, dead export"
status: complete
priority: P3
type: refactor
created: "2026-07-16T22:38:16.369Z"
updated: "2026-07-16T23:15:02.828Z"
dependencies: []
completed_at: "2026-07-16T23:15:02.827Z"
---

# [STYLE-5] Module splits: gitops.js, agents status engine, errMsg, dead export

## Problem Statement

Continue the codebase extract-to-module pattern. STYLE-5(conf80): renderer/agents.js (602 lines) mixes 5 responsibilities; extract the status state machine (setStatus/markActivity/detectPrompts/onEvent) into its own module mirroring tui-signals.mjs/agent-git.mjs. STYLE-4(72): main.js (880 lines) keeps growing - extract worktree/branch git orchestration into gitops.js; add errMsg(err) for the 11x String(err.message||err) dup. STYLE-2(85): PTYPE_SKIP_DIRS is a dead export in gitinfo.js.

## Acceptance Criteria

- [x] Extract agents.js status engine into its own module
- [x] Extract main.js worktree/branch git orchestration into gitops.js
- [x] Add errMsg helper, replace the 11 duplications
- [x] Remove the dead PTYPE_SKIP_DIRS export

## Files

- renderer/agents.js
- main.js
- gitinfo.js

## Work Log

### 2026-07-16T23:15:02.591Z - Extracted gitops.js + renderer/agent-status.mjs + util.js(errMsg); removed dead PTYPE_SKIP_DIRS export; wiring verified (onData/onExit/onEvent), 81 pass

