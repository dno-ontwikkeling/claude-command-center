---
id: 017-90ea
title: "[BUG-5] projects:add/remove return un-enriched records"
status: complete
priority: P2
type: fix
created: "2026-07-16T20:25:27.210Z"
updated: "2026-07-16T20:48:15.431Z"
dependencies: []
tags: ["review", "BUG-5"]
completed_at: "2026-07-16T20:48:15.430Z"
---

# [BUG-5] projects:add/remove return un-enriched records

## Problem Statement

projects:add/remove return raw {dir,name} while list/reorder/workspace handlers .map(enrich). After add/remove, every project loses its type/isGit icon until the next 15s poll.

## Acceptance Criteria

- [x] projects:add returns enrich(record)
- [x] projects:remove returns projects.map(enrich)
- [x] Sidebar icons persist immediately after add/remove

## Files

- main.js
- renderer/sidebar.js

## Work Log

### 2026-07-16T20:26:44.100Z - Source: reviews/review-2026-07-16-full-app.md finding [BUG-5]

### 2026-07-16T20:48:15.185Z - Wave 3: implemented + node --check passed

