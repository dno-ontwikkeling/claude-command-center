---
id: 004-d0e8
title: [PERF-1] Sidebar re-spawns git per row on every render
status: complete
priority: P1
type: refactor
created: "2026-07-16T20:25:27.200Z"
updated: "2026-07-16T20:48:14.647Z"
dependencies: []
tags: ["review", "PERF-1"]
completed_at: "2026-07-16T20:48:14.646Z"
---

# [PERF-1] Sidebar re-spawns git per row on every render

## Problem Statement

buildAgentRow spawns git branch + git diff --numstat per agent row on every renderSidebar() call (15s interval, focus, spawn/kill/rename/reorder/collapse, every filter keystroke). 2xN git child processes per call stall all PTYs since main process is single-threaded.

## Acceptance Criteria

- [x] Cache branch/diffstat per agent
- [x] Refresh git data on a longer independent timer or explicit action, not per render
- [x] Dedupe in-flight git calls per agent
- [x] Do not trigger git lookups from filter/collapse/reorder

## Files

- renderer/sidebar.js
- main.js

## Work Log

### 2026-07-16T20:26:41.247Z - Source: reviews/review-2026-07-16-full-app.md finding [PERF-1]

### 2026-07-16T20:48:14.414Z - Wave 3: implemented + node --check passed

