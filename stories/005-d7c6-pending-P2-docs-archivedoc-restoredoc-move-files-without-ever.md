---
id: 005-d7c6
title: "docs: archiveDoc/restoreDoc move files without ever overwriting"
status: pending
priority: P2
type: feature
created: "2026-10-05T17:44:21.892Z"
updated: "2026-10-05T17:44:48.538Z"
dependencies: ["004-56f8"]
plan: plans/docs-management.md
plan_step: Step 5
depends_on: ["stories/004-56f8-pending-P2-docs-resolvedoc-path-guard-readdoc-cwd-folders-rel.md"]
---

# docs: archiveDoc/restoreDoc move files without ever overwriting

## Problem Statement

Users need to archive and restore docs from the panel; a name clash must never silently destroy a file.

## Acceptance Criteria

- [ ] archive moves plans/a.md to plans/archive/a.md, creates archive/ if missing, returns the new rel
- [ ] A name clash picks a free name (a (2).md, then a (3).md) and the original files' content is untouched; restore mirrors the same clash rule
- [ ] Archiving an already-archived doc, or restoring a non-archived doc, returns ok:false; a missing file returns ok:false without throwing; the root folder '.' works the same way (README.md <-> archive/README.md)
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

