---
id: 006-96ea
title: "docs: groupDocs/folderLabel/newestDoc picker helpers"
status: ready
priority: P2
type: feature
created: "2026-10-05T17:44:21.894Z"
updated: "2026-10-05T17:45:07.460Z"
dependencies: []
plan: plans/docs-management.md
plan_step: Step 6
---

# docs: groupDocs/folderLabel/newestDoc picker helpers

## Problem Statement

The picker needs to group docs by configured folder order with a trailing Archived group, and the panel needs to default to the newest non-archived doc.

## Acceptance Criteria

- [ ] groupDocs follows the folders array order, places an Archived group right after its folder, omits empty groups, and does not mutate its input list
- [ ] folderLabel('.') -> 'Root', folderLabel('plans') -> 'Plans'
- [ ] newestDoc skips archived docs and returns null when only archived docs exist; docsSignature changes when a doc's archived flag flips
- [ ] VERIFY: node --test test/docs-view.test.mjs

## Files

- renderer/docs-view.mjs
- test/docs-view.test.mjs

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

