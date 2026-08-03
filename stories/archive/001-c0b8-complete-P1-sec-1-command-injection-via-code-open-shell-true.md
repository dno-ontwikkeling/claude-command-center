---
id: 001-c0b8
title: "[SEC-1] Command injection via code:open shell:true"
status: complete
priority: P1
type: fix
created: "2026-07-16T20:25:27.195Z"
updated: "2026-07-16T20:43:25.674Z"
dependencies: []
tags: ["review", "SEC-1"]
completed_at: "2026-07-16T20:43:25.674Z"
---

# [SEC-1] Command injection via code:open shell:true

## Problem Statement

openInVSCode runs execFile('code',[cwd],{shell:true}) routing a git-branch-derived path through cmd.exe. Branch/workspace names are only sanitized for / and \, so shell metacharacters (& % ( ) !) in a hostile branch name can inject commands when opened in VS Code.

## Acceptance Criteria

- [x] Remove shell:true from openInVSCode
- [x] Resolve code.cmd real path once (where code, cached) and spawn with shell:false, windowsHide:true
- [x] Reject or escape folder names with shell metacharacters at creation
- [x] Verify launching VS Code still works on Windows

## Files

- main.js

## Work Log

### 2026-07-16T20:26:45.454Z - Source: reviews/review-2026-07-16-full-app.md finding [SEC-1]

### 2026-07-16T20:43:25.441Z - Wave 2: implemented + node --check passed

