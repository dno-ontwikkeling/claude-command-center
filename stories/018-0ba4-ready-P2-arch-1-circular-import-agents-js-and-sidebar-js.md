---
id: 018-0ba4
title: [ARCH-1] Circular import agents.js and sidebar.js
status: ready
priority: P2
type: refactor
created: "2026-07-16T20:25:27.210Z"
updated: "2026-07-16T20:26:47.507Z"
dependencies: []
tags: ["review", "ARCH-1"]
---

# [ARCH-1] Circular import agents.js and sidebar.js

## Problem Statement

agents.js imports renderSidebar from sidebar.js while sidebar.js imports lifecycle fns from agents.js. Works only because cross-calls are inside runtime function bodies; a top-level alias would break with an ESM TDZ error.

## Acceptance Criteria

- [ ] agents.js emits lifecycle changes (pub/sub or app.js-registered callback) instead of importing renderSidebar
- [ ] A coordinator layer calls renderSidebar() after state-changing actions
- [ ] No direct import cycle remains

## Files

- renderer/agents.js
- renderer/sidebar.js
- renderer/app.js

## Work Log

### 2026-07-16T20:26:47.745Z - Source: reviews/review-2026-07-16-full-app.md finding [ARCH-1]

