---
id: 023-5a57
title: "[PERF-1] Unscoped git:changed fan-out spawns N subprocesses per change"
status: ready
priority: P2
type: fix
created: "2026-07-16T22:38:16.361Z"
updated: "2026-07-16T22:38:40.628Z"
dependencies: []
---

# [PERF-1] Unscoped git:changed fan-out spawns N subprocesses per change

## Problem Statement

fs.watch callback (main.js:477) discards which dir changed and calls scheduleGitChanged(); renderer onGitChanged unconditionally runs refreshProjects()+refreshAllAgentsGit(), the latter spawns git diff --numstat HEAD for EVERY live agent not just the changed repo. Single commit = N subprocesses per 400ms window (conf88). Folds PERF-3: two independent 15s pollers double steady-state git load.

## Acceptance Criteria

- [ ] Pass the changed dir through the git:changed IPC payload
- [ ] Refresh only agents whose cwd is under the changed dir
- [ ] Coalesce the two 15s foreground pollers into one scheduler (PERF-3)

## Files

- main.js
- renderer/app.js
- renderer/agent-git.mjs

## Work Log

