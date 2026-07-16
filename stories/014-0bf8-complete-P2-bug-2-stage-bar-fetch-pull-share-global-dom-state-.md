---
id: 014-0bf8
title: [BUG-2] Stage-bar fetch/pull share global DOM state across agents
status: complete
priority: P2
type: fix
created: "2026-07-16T20:25:27.208Z"
updated: "2026-07-16T20:38:16.354Z"
dependencies: []
tags: ["review", "BUG-2"]
completed_at: "2026-07-16T20:38:16.353Z"
---

# [BUG-2] Stage-bar fetch/pull share global DOM state across agents

## Problem Statement

updateStageBar re-enables buttons on every activate(). Fetch on A, switch to B, fetch on B runs two concurrent runGit sharing the same btn/lbl; first to finish resets disabled/label, corrupting the other's in-progress state.

## Acceptance Criteria

- [x] Track a per-operation in-flight token independent of active agent
- [x] Prevent overlapping fetch/pull from corrupting button state

## Files

- renderer/stage.js

## Work Log

### 2026-07-16T20:26:48.218Z - Source: reviews/review-2026-07-16-full-app.md finding [BUG-2]

### 2026-07-16T20:38:16.113Z - Wave 1: implemented + node --check passed

