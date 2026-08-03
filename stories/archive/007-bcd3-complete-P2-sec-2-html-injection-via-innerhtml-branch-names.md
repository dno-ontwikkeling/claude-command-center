---
id: 007-bcd3
title: [SEC-2] HTML injection via innerHTML branch names
status: complete
priority: P2
type: fix
created: "2026-07-16T20:25:27.203Z"
updated: "2026-07-16T20:38:13.978Z"
dependencies: []
tags: ["review", "SEC-2"]
completed_at: "2026-07-16T20:38:13.978Z"
---

# [SEC-2] HTML injection via innerHTML branch names

## Problem Statement

worktree.js sets innerHTML with ref.label/b.name/r.name from git branch output. CSP blocks script today but this is a defense-in-depth failure enabling UI-spoof/phishing and full XSS under any CSP relaxation.

## Acceptance Criteria

- [x] Replace innerHTML with textContent/DOM nodes at worktree.js:108,178,186
- [x] Match the textContent pattern used in diff.js and worktree.js:150-173

## Files

- renderer/worktree.js

## Work Log

### 2026-07-16T20:26:45.003Z - Source: reviews/review-2026-07-16-full-app.md finding [SEC-2]

### 2026-07-16T20:38:13.747Z - Wave 1: implemented + node --check passed

