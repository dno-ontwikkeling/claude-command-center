---
id: 024-7ba9
title: [BUG-1] Resume-after-spawn-failure error destroyed before it renders
status: ready
priority: P2
type: fix
created: "2026-07-16T22:38:16.363Z"
updated: "2026-07-16T22:38:40.738Z"
dependencies: []
---

# [BUG-1] Resume-after-spawn-failure error destroyed before it renders

## Problem Statement

On resume used is set true unconditionally (agents.js:172). If the pty fails to start (worktree cwd deleted, claude missing) agent:exit arrives with error; handler writes error to a.term then because sessionId&&used&&!intentional immediately calls convertToDormant which synchronously term.dispose()+el.remove(), tearing down the terminal before the text paints. Repeated Resume clicks reproduce silently. Validated conf80.

## Acceptance Criteria

- [ ] When agent:exit carries error, skip convertToDormant and surface a dialog/toast instead of writing to a soon-disposed terminal
- [ ] Repeated Resume of a broken session gives visible feedback each time

## Files

- renderer/agents.js

## Work Log

