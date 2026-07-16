---
id: 008-bcac
title: [SEC-3] Unauthenticated localhost hook-event server
status: ready
priority: P2
type: fix
created: "2026-07-16T20:25:27.204Z"
updated: "2026-07-16T20:26:43.376Z"
dependencies: []
tags: ["review", "SEC-3"]
---

# [SEC-3] Unauthenticated localhost hook-event server

## Problem Statement

POST /event on 127.0.0.1 has no shared secret. Any local process can spoof status/notifications and overwrite agent.sessionId (persisted, later used in claude --resume), redirecting session resumption.

## Acceptance Criteria

- [ ] Generate a per-run random secret passed to agents via env alongside CC_PORT/CC_AGENT_ID
- [ ] Require the secret on /event; reject requests without it
- [ ] Validate agentId against the live agents map before forwarding to renderer

## Files

- main.js
- renderer/agents.js
- hooks/report.js

## Work Log

### 2026-07-16T20:26:43.606Z - Source: reviews/review-2026-07-16-full-app.md finding [SEC-3]

