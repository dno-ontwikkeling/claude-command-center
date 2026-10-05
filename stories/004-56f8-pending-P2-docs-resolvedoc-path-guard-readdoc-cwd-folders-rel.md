---
id: 004-56f8
title: "docs: resolveDoc path guard + readDoc(cwd, folders, rel)"
status: pending
priority: P2
type: feature
created: "2026-10-05T17:44:21.890Z"
updated: "2026-10-05T17:44:46.927Z"
dependencies: ["003-02e9"]
plan: plans/docs-management.md
plan_step: Step 4
depends_on: ["stories/003-02e9-pending-P2-docs-listdocs-lists-configured-folders-plus-their-.md"]
---

# docs: resolveDoc path guard + readDoc(cwd, folders, rel)

## Problem Statement

Every read and action must go through one guard so a doc outside the configured folders, a path escape, or a symlinked folder can never be reached.

## Acceptance Criteria

- [ ] Existing readDoc rejection tests (.., absolute, extension, missing file, size cap) pass with folders defaulted
- [ ] README.md ok with folders:['.'], rejected with defaults; plans/sub/x.md rejected (not archive); plans/archive/x.md ok; an unconfigured folder rejected
- [ ] A configured folder that is a symlink pointing outside cwd is rejected (skip on EPERM, same as the existing symlink test); a vanished file returns a 'no longer exists' error instead of throwing
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

