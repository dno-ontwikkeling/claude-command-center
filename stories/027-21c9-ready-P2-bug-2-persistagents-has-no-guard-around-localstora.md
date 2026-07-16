---
id: 027-21c9
title: [BUG-2] persistAgents has no guard around localStorage.setItem
status: ready
priority: P2
type: fix
created: "2026-07-16T22:38:16.365Z"
updated: "2026-07-16T22:38:41.083Z"
dependencies: []
---

# [BUG-2] persistAgents has no guard around localStorage.setItem

## Problem Statement

persistAgents() (state.js:105-114) can throw synchronously (quota, private-mode, non-serializable field) uncaught. spawn() calls persistAgents() before notifyAgentsChanged()/activate(id); a throw aborts those, leaving a live pty in main with no sidebar row - split-brain. The read side is defensively wrapped, the write side is not (conf62).

## Acceptance Criteria

- [ ] Wrap persistAgents body in try/catch with a logged warning
- [ ] A persist failure does not abort spawn notify/activate sequence

## Files

- renderer/state.js

## Work Log

