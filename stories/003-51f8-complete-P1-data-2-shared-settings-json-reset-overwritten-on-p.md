---
id: 003-51f8
title: [DATA-2] Shared settings.json reset+overwritten on parse fail
status: complete
priority: P1
type: fix
created: "2026-07-16T20:25:27.199Z"
updated: "2026-07-16T20:43:27.193Z"
dependencies: []
tags: ["review", "DATA-2"]
completed_at: "2026-07-16T20:43:27.193Z"
---

# [DATA-2] Shared settings.json reset+overwritten on parse fail

## Problem Statement

ensureHooksInstalled sets settings={} on JSON parse failure of the shared CLI ~/.claude/settings.json (not owned by this app), then writes it back on Install — wiping the user's permissions/model prefs/other hooks. No backup taken.

## Acceptance Criteria

- [x] Distinguish missing file from parse failure
- [x] Never write a defaulted-empty settings object over an existing file that failed to parse
- [x] Back up unreadable settings.json before any write
- [x] Preserve all pre-existing keys when merging hooks block

## Files

- main.js

## Work Log

### 2026-07-16T20:26:48.677Z - Source: reviews/review-2026-07-16-full-app.md finding [DATA-2]

### 2026-07-16T20:43:26.961Z - Wave 2: implemented + node --check passed

