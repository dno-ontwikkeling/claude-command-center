---
id: 017-90ea
title: "[BUG-5] projects:add/remove return un-enriched records"
status: ready
priority: P2
type: fix
created: "2026-07-16T20:25:27.210Z"
updated: "2026-07-16T20:26:43.860Z"
dependencies: []
tags: ["review", "BUG-5"]
---

# [BUG-5] projects:add/remove return un-enriched records

## Problem Statement

projects:add/remove return raw {dir,name} while list/reorder/workspace handlers .map(enrich). After add/remove, every project loses its type/isGit icon until the next 15s poll.

## Acceptance Criteria

- [ ] projects:add returns enrich(record)
- [ ] projects:remove returns projects.map(enrich)
- [ ] Sidebar icons persist immediately after add/remove

## Files

- main.js
- renderer/sidebar.js

## Work Log

### 2026-07-16T20:26:44.100Z - Source: reviews/review-2026-07-16-full-app.md finding [BUG-5]

