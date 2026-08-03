---
id: 010-6e73
title: [DATA-4] Force branch delete -D lacks unmerged-commit warning
status: complete
priority: P2
type: fix
created: "2026-07-16T20:25:27.205Z"
updated: "2026-07-16T20:52:27.201Z"
dependencies: []
tags: ["review", "DATA-4"]
completed_at: "2026-07-16T20:52:27.200Z"
---

# [DATA-4] Force branch delete -D lacks unmerged-commit warning

## Problem Statement

git:delete-branch uses -D (force), triggered by the 'Also delete the local branch' checkbox, deleting regardless of merge/push status. Unpushed commits become unreachable with no warning.

## Acceptance Criteria

- [x] Default to -d (safe) delete
- [x] Only force -D after explicit extra confirmation
- [x] Warn about unmerged/unpushed commits (check git branch --merged or upstream) before -D

## Files

- main.js
- renderer/agents.js

## Work Log

### 2026-07-16T20:26:40.365Z - Source: reviews/review-2026-07-16-full-app.md finding [DATA-4]

### 2026-07-16T20:52:26.953Z - Wave 4: implemented + node --check passed

