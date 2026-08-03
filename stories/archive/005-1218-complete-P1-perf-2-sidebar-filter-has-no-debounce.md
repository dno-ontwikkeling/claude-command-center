---
id: 005-1218
title: [PERF-2] Sidebar filter has no debounce
status: complete
priority: P1
type: fix
created: "2026-07-16T20:25:27.201Z"
updated: "2026-07-16T20:38:13.179Z"
dependencies: []
tags: ["review", "PERF-2"]
completed_at: "2026-07-16T20:38:13.178Z"
---

# [PERF-2] Sidebar filter has no debounce

## Problem Statement

Filter input rebuilds the entire sidebar DOM and (via PERF-1) re-spawns 2xN git processes on every keystroke. A 6-char filter with 10 agents can be up to 120 git spawns.

## Acceptance Criteria

- [x] Debounce filter input 150-250ms
- [x] Filtering toggles row visibility via CSS instead of full data rebuild

## Files

- renderer/sidebar.js

## Work Log

### 2026-07-16T20:26:45.896Z - Source: reviews/review-2026-07-16-full-app.md finding [PERF-2]

### 2026-07-16T20:38:12.946Z - Wave 1: implemented + node --check passed

