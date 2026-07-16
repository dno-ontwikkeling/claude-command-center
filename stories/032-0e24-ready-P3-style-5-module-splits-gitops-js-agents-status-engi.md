---
id: 032-0e24
title: "[STYLE-5] Module splits: gitops.js, agents status engine, errMsg, dead export"
status: ready
priority: P3
type: refactor
created: "2026-07-16T22:38:16.369Z"
updated: "2026-07-16T22:38:41.667Z"
dependencies: []
---

# [STYLE-5] Module splits: gitops.js, agents status engine, errMsg, dead export

## Problem Statement

Continue the codebase extract-to-module pattern. STYLE-5(conf80): renderer/agents.js (602 lines) mixes 5 responsibilities; extract the status state machine (setStatus/markActivity/detectPrompts/onEvent) into its own module mirroring tui-signals.mjs/agent-git.mjs. STYLE-4(72): main.js (880 lines) keeps growing - extract worktree/branch git orchestration into gitops.js; add errMsg(err) for the 11x String(err.message||err) dup. STYLE-2(85): PTYPE_SKIP_DIRS is a dead export in gitinfo.js.

## Acceptance Criteria

- [ ] Extract agents.js status engine into its own module
- [ ] Extract main.js worktree/branch git orchestration into gitops.js
- [ ] Add errMsg helper, replace the 11 duplications
- [ ] Remove the dead PTYPE_SKIP_DIRS export

## Files

- renderer/agents.js
- main.js
- gitinfo.js

## Work Log

