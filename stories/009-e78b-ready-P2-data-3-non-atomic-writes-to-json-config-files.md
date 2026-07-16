---
id: 009-e78b
title: [DATA-3] Non-atomic writes to JSON config files
status: ready
priority: P2
type: fix
created: "2026-07-16T20:25:27.204Z"
updated: "2026-07-16T20:26:46.567Z"
dependencies: []
tags: ["review", "DATA-3"]
---

# [DATA-3] Non-atomic writes to JSON config files

## Problem Statement

saveProjects/saveWorkspaces/ensureHooksInstalled use direct fs.writeFileSync to the live file. Crash/power-loss mid-write leaves a truncated file which DATA-1/DATA-2 then treat as empty and overwrite.

## Acceptance Criteria

- [ ] Write to a temp file then fs.renameSync over the target
- [ ] Apply to all three JSON write sites (main.js:63-64, 74-77, 340)

## Files

- main.js

## Work Log

### 2026-07-16T20:26:46.799Z - Source: reviews/review-2026-07-16-full-app.md finding [DATA-3]

