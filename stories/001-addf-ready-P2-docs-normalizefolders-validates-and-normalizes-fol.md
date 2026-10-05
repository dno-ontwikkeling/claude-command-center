---
id: 001-addf
title: "docs: normalizeFolders validates and normalizes folder config"
status: ready
priority: P2
type: feature
created: "2026-10-05T17:44:21.831Z"
updated: "2026-10-05T17:45:07.307Z"
dependencies: []
plan: plans/docs-management.md
plan_step: Step 1
---

# docs: normalizeFolders validates and normalizes folder config

## Problem Statement

The docs panel needs a per-project folder list; raw user/record input must be validated before it ever reaches the filesystem guard.

## Acceptance Criteria

- [ ] Accepts plans, docs/api, . ; normalizes a backslash form like docs\api to docs/api and '' to .
- [ ] Rejects .., a/../b, a drive-letter path, an absolute path, a UNC share, a null byte, archive, plans/archive
- [ ] Case-insensitive dedupe; caps at 20 entries with an error; [] and non-array handled
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

