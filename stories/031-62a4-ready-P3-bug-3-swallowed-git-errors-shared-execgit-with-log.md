---
id: 031-62a4
title: [BUG-3] Swallowed git errors - shared execGit with logging + diffstat maxBuffer
status: ready
priority: P3
type: refactor
created: "2026-07-16T22:38:16.368Z"
updated: "2026-07-16T22:38:41.550Z"
dependencies: []
---

# [BUG-3] Swallowed git errors - shared execGit with logging + diffstat maxBuffer

## Problem Statement

BUG-3(conf80): worktreeStatus/listWorktrees/listBranches/listRemoteBranches/git:diffstat map any git error to a legit empty state with zero logging; on a 15s poll a broken env shows a permanently empty sidebar with no trail. BUG-4(55): git:diffstat uses the 1MB default maxBuffer (git:diff sets 64MB); a large diff overflows and shows a misleading clean badge. STYLE-3(78): execFile git boilerplate duplicated ~12x while runGit is used by only 3.

## Acceptance Criteria

- [ ] Add a shared execGit(dir,args,opts) helper that log.warn's failures
- [ ] Route the ~12 inline call sites through it
- [ ] git:diffstat uses the same 64MB maxBuffer as git:diff

## Files

- main.js

## Work Log

