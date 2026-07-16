---
id: 013-21f9
title: [BUG-1] Diff viewer mislabels content on mid-load mode switch
status: complete
priority: P2
type: fix
created: "2026-07-16T20:25:27.207Z"
updated: "2026-07-16T20:38:15.538Z"
dependencies: []
tags: ["review", "BUG-1"]
completed_at: "2026-07-16T20:38:15.537Z"
---

# [BUG-1] Diff viewer mislabels content on mid-load mode switch

## Problem Statement

diff.js load() captures mode before await for the fetch but re-reads current mode after for the subtitle. Concurrent loads (tabs never disabled) can show a wip diff labeled 'vs origin/main' or vice versa.

## Acceptance Criteria

- [x] Capture requestedMode = mode at top of load()
- [x] Display subtitle and content based on captured value
- [x] Guard on requestedMode !== mode like the cwd guard

## Files

- renderer/diff.js

## Work Log

### 2026-07-16T20:26:46.340Z - Source: reviews/review-2026-07-16-full-app.md finding [BUG-1]

### 2026-07-16T20:38:15.310Z - Wave 1: implemented + node --check passed

