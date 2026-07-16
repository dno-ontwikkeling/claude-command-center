---
id: 002-9154
title: [DATA-1] Corrupt config silently overwritten (data loss)
status: ready
priority: P1
type: fix
created: "2026-07-16T20:25:27.198Z"
updated: "2026-07-16T20:26:47.026Z"
dependencies: []
tags: ["review", "DATA-1"]
---

# [DATA-1] Corrupt config silently overwritten (data loss)

## Problem Statement

loadProjects/loadWorkspaces catch{return []} treat a corrupt/truncated/permission-failed read as first-run. The next mutation calls save*() over the file, permanently destroying the real project/workspace registry with no warning.

## Acceptance Criteria

- [ ] Distinguish ENOENT (first run) from parse/IO errors
- [ ] On parse/IO error do NOT return empty; back up bad file to .bak-<ts>
- [ ] Surface a dialog before any write can occur
- [ ] Applies to both loadProjects and loadWorkspaces

## Files

- main.js

## Work Log

### 2026-07-16T20:26:47.275Z - Source: reviews/review-2026-07-16-full-app.md finding [DATA-1]

