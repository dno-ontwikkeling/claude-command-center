---
id: 029-15da
title: [TEST-2] main.js hook HTTP server + settings-merge untested
status: complete
priority: P2
type: chore
created: "2026-07-16T22:38:16.367Z"
updated: "2026-07-16T22:58:37.387Z"
dependencies: []
completed_at: "2026-07-16T22:58:37.387Z"
---

# [TEST-2] main.js hook HTTP server + settings-merge untested

## Problem Statement

The actual security enforcement (agents.has(id)+secretMatches, 404/403/200, 64KB cutoff, malformed-JSON) is untested - hookauth.test.js only tests pure crypto helpers. The hook-merge into the user shared ~/.claude/settings.json (a file the app does not own) is untested; a bug could corrupt existing Claude settings (conf93).

## Acceptance Criteria

- [x] Extract the request handler + hooks-merge logic into electron-free testable functions
- [x] Integration-test the server with a fake agents map: 404 unknown, 403 bad token, 200 valid, 413 oversized, 400 malformed
- [x] Test merge: no duplicate on re-run, corrupt-settings abort, existing keys preserved

## Files

- main.js
- test/

## Work Log

### 2026-07-16T22:58:37.158Z - Wave 3: extracted hookserver.js + hooksmerge.js (electron-free), 20 new tests; 81 pass + typecheck green

