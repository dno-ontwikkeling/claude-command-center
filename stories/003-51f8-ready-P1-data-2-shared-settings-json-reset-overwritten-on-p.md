---
id: 003-51f8
title: [DATA-2] Shared settings.json reset+overwritten on parse fail
status: ready
priority: P1
type: fix
created: "2026-07-16T20:25:27.199Z"
updated: "2026-07-16T20:26:48.447Z"
dependencies: []
tags: ["review", "DATA-2"]
---

# [DATA-2] Shared settings.json reset+overwritten on parse fail

## Problem Statement

ensureHooksInstalled sets settings={} on JSON parse failure of the shared CLI ~/.claude/settings.json (not owned by this app), then writes it back on Install — wiping the user's permissions/model prefs/other hooks. No backup taken.

## Acceptance Criteria

- [ ] Distinguish missing file from parse failure
- [ ] Never write a defaulted-empty settings object over an existing file that failed to parse
- [ ] Back up unreadable settings.json before any write
- [ ] Preserve all pre-existing keys when merging hooks block

## Files

- main.js

## Work Log

### 2026-07-16T20:26:48.677Z - Source: reviews/review-2026-07-16-full-app.md finding [DATA-2]

