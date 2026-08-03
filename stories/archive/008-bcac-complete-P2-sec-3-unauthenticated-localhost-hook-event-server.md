---
id: 008-bcac
title: [SEC-3] Unauthenticated localhost hook-event server
status: complete
priority: P2
type: fix
created: "2026-07-16T20:25:27.204Z"
updated: "2026-07-16T20:52:26.409Z"
dependencies: []
tags: ["review", "SEC-3"]
completed_at: "2026-07-16T20:52:26.409Z"
---

# [SEC-3] Unauthenticated localhost hook-event server

## Problem Statement

POST /event on 127.0.0.1 has no shared secret. Any local process can spoof status/notifications and overwrite agent.sessionId (persisted, later used in claude --resume), redirecting session resumption.

## Acceptance Criteria

- [x] Generate a per-run random secret passed to agents via env alongside CC_PORT/CC_AGENT_ID
- [x] Require the secret on /event; reject requests without it
- [x] Validate agentId against the live agents map before forwarding to renderer

## Files

- main.js
- renderer/agents.js
- hooks/report.js

## Work Log

### 2026-07-16T20:26:43.606Z - Source: reviews/review-2026-07-16-full-app.md finding [SEC-3]

### 2026-07-16T20:52:26.176Z - Wave 4: implemented + node --check passed

