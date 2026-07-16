---
id: 018-0ba4
title: [ARCH-1] Circular import agents.js and sidebar.js
status: complete
priority: P2
type: refactor
created: "2026-07-16T20:25:27.210Z"
updated: "2026-07-16T20:43:28.740Z"
dependencies: []
tags: ["review", "ARCH-1"]
completed_at: "2026-07-16T20:43:28.739Z"
---

# [ARCH-1] Circular import agents.js and sidebar.js

## Problem Statement

agents.js imports renderSidebar from sidebar.js while sidebar.js imports lifecycle fns from agents.js. Works only because cross-calls are inside runtime function bodies; a top-level alias would break with an ESM TDZ error.

## Acceptance Criteria

- [x] agents.js emits lifecycle changes (pub/sub or app.js-registered callback) instead of importing renderSidebar
- [x] A coordinator layer calls renderSidebar() after state-changing actions
- [x] No direct import cycle remains

## Files

- renderer/agents.js
- renderer/sidebar.js
- renderer/app.js

## Work Log

### 2026-07-16T20:26:47.745Z - Source: reviews/review-2026-07-16-full-app.md finding [ARCH-1]

### 2026-07-16T20:43:28.500Z - Wave 2: implemented + node --check passed

