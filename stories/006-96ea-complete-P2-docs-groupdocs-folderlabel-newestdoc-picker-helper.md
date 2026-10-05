---
id: 006-96ea
title: "docs: groupDocs/folderLabel/newestDoc picker helpers"
status: complete
priority: P2
type: feature
created: "2026-10-05T17:44:21.894Z"
updated: "2026-10-05T17:55:55.567Z"
dependencies: []
plan: plans/docs-management.md
plan_step: Step 6
started_at: "2026-10-05T17:54:32.724Z"
completed_at: "2026-10-05T17:55:55.567Z"
---

# docs: groupDocs/folderLabel/newestDoc picker helpers

## Problem Statement

The picker needs to group docs by configured folder order with a trailing Archived group, and the panel needs to default to the newest non-archived doc.

## Acceptance Criteria

- [x] groupDocs follows the folders array order, places an Archived group right after its folder, omits empty groups, and does not mutate its input list
- [x] folderLabel('.') -> 'Root', folderLabel('plans') -> 'Plans'
- [x] newestDoc skips archived docs and returns null when only archived docs exist; docsSignature changes when a doc's archived flag flips
- [x] VERIFY: node --test test/docs-view.test.mjs

## Files

- renderer/docs-view.mjs
- test/docs-view.test.mjs

## Proof

- [x] [completeness] Completeness (test/docs-view.test.mjs: config order, Archived-after-folder incl. Root, empty omitted, no mutation, folderLabel, newestDoc, signature flip — 20/20; npm test 320/320)
- [x] [feature-availability] Feature availability (docs-panel.js now calls groupDocs（list, folders） and newestDoc, so the live picker groups by folder with Archived groups on the default folders)
- [x] [robustness] Robustness (newestDoc returns null for [] and archived-only lists; panel falls back to list[0] so an archived-only project still shows a doc)
- [~] [resilience] Resilience (Pure in-memory helpers)
- [~] [security] Security (No I/O; labels are rendered via textContent in docs-panel.js renderPicker)
- [~] [defense-in-depth] Defense in depth (Presentation helpers only)
- [~] [input-validation] Input validation (Inputs come from listDocs （validated main-side）)
- [~] [thread-safety] Thread safety (Pure functions; groupDocs does not mutate input （tested）)
- [x] [configurability] Configurability (group order follows the folders argument （['reviews','plans'] reverses the groups, tested）)

## QA

None — covered by tests

## Work Log


### 2026-10-05T17:55:30.078Z - Proof completeness set PROVEN: test/docs-view.test.mjs: config order, Archived-after-folder incl. Root, empty omitted, no mutation, folderLabel, newestDoc, signature flip — 20/20; npm test 320/320

### 2026-10-05T17:55:31.755Z - Proof feature-availability set PROVEN: docs-panel.js now calls groupDocs(list, folders) and newestDoc, so the live picker groups by folder with Archived groups on the default folders

### 2026-10-05T17:55:33.431Z - Proof robustness set PROVEN: newestDoc returns null for [] and archived-only lists; panel falls back to list[0] so an archived-only project still shows a doc

### 2026-10-05T17:55:35.351Z - Proof resilience set NOT_APPLICABLE: Pure in-memory helpers

### 2026-10-05T17:55:36.865Z - Proof security set NOT_APPLICABLE: No I/O; labels are rendered via textContent in docs-panel.js renderPicker

### 2026-10-05T17:55:38.331Z - Proof defense-in-depth set NOT_APPLICABLE: Presentation helpers only

### 2026-10-05T17:55:39.833Z - Proof input-validation set NOT_APPLICABLE: Inputs come from listDocs (validated main-side)

### 2026-10-05T17:55:41.323Z - Proof thread-safety set NOT_APPLICABLE: Pure functions; groupDocs does not mutate input (tested)

### 2026-10-05T17:55:42.792Z - Proof configurability set PROVEN: group order follows the folders argument (['reviews','plans'] reverses the groups, tested)

### 2026-10-05T17:55:44.328Z - Completed: folderLabel, groupDocs(list, folders), newestDoc, docsSignature includes archived. RED: missing export folderLabel. GREEN docs-view 20/20. Bridged docs-panel.js to groupDocs(..., folders) with defaults + newestDoc so the branch's live panel works again (fixes the transitional empty picker from 003). npm test 320/320, typecheck clean.

