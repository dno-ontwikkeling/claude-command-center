---
id: 019-9b6b
title: [ARCH-2] No single-instance lock — instances race on JSON stores
status: complete
priority: P2
type: fix
created: "2026-07-16T20:25:27.211Z"
updated: "2026-07-16T20:38:17.892Z"
dependencies: []
tags: ["review", "ARCH-2"]
completed_at: "2026-07-16T20:38:17.891Z"
---

# [ARCH-2] No single-instance lock — instances race on JSON stores

## Problem Statement

App lacks app.requestSingleInstanceLock(). A second instance races on projects.json/workspaces.json, compounding non-atomic-write and lost-update issues.

## Acceptance Criteria

- [x] Add app.requestSingleInstanceLock()
- [x] On second-instance, focus the existing window
- [x] Second launch does not create a competing process

## Files

- main.js

## Work Log

### 2026-07-16T20:26:44.550Z - Source: reviews/review-2026-07-16-full-app.md finding [ARCH-2]

### 2026-07-16T20:38:17.659Z - Wave 1: implemented + node --check passed

