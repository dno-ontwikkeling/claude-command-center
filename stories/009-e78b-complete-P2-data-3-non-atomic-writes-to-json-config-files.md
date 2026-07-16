---
id: 009-e78b
title: [DATA-3] Non-atomic writes to JSON config files
status: complete
priority: P2
type: fix
created: "2026-07-16T20:25:27.204Z"
updated: "2026-07-16T20:43:27.971Z"
dependencies: []
tags: ["review", "DATA-3"]
completed_at: "2026-07-16T20:43:27.970Z"
---

# [DATA-3] Non-atomic writes to JSON config files

## Problem Statement

saveProjects/saveWorkspaces/ensureHooksInstalled use direct fs.writeFileSync to the live file. Crash/power-loss mid-write leaves a truncated file which DATA-1/DATA-2 then treat as empty and overwrite.

## Acceptance Criteria

- [x] Write to a temp file then fs.renameSync over the target
- [x] Apply to all three JSON write sites

## Files

- main.js

## Work Log

### 2026-07-16T20:26:46.799Z - Source: reviews/review-2026-07-16-full-app.md finding [DATA-3]

### 2026-07-16T20:43:27.735Z - Wave 2: implemented + node --check passed

