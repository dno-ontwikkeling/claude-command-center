---
id: 003-02e9
title: "docs: listDocs lists configured folders plus their archive/ subfolder"
status: pending
priority: P2
type: feature
created: "2026-10-05T17:44:21.889Z"
updated: "2026-10-05T17:44:45.331Z"
dependencies: ["002-4e09"]
plan: plans/docs-management.md
plan_step: Step 3
depends_on: ["stories/002-4e09-pending-P2-docs-docfoldersfor-withdocfolders-record-helpers-c.md"]
---

# docs: listDocs lists configured folders plus their archive/ subfolder

## Problem Statement

The picker needs every doc across the configured folders, grouped and marked archived, without recursing into the rest of the repo.

## Acceptance Criteria

- [ ] Entries are {rel, folder, archived, mtimeMs, size}; plans/archive/x.md -> archived:true, folder:'plans'
- [ ] '.' lists only root files (README.md) and never node_modules or plans/a.md; root archive/old.md -> folder:'.', archived:true
- [ ] Missing folder contributes nothing; nested config (docs + docs/api) lists both; default folders arg keeps today's plans/reviews behaviour; a folder over 500 files is capped at 500
- [ ] VERIFY: node --test test/docs.test.js

## Files

- docs.js
- test/docs.test.js

## Proof

- [ ] [completeness] Completeness
- [ ] [feature-availability] Feature availability
- [ ] [robustness] Robustness
- [ ] [resilience] Resilience
- [ ] [security] Security
- [ ] [defense-in-depth] Defense in depth
- [ ] [input-validation] Input validation
- [ ] [thread-safety] Thread safety
- [ ] [configurability] Configurability

## Work Log

