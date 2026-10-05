---
id: 009-742e
title: "docs: Folders… overlay to edit per-project doc folders"
status: complete
priority: P2
type: feature
created: "2026-10-05T17:44:21.900Z"
updated: "2026-10-05T18:01:02.878Z"
dependencies: ["007-4ec2"]
plan: plans/docs-management.md
plan_step: Step 9
depends_on: ["stories/007-4ec2-pending-P2-docs-ipc-wiring-for-folders-config-and-doc-actions.md"]
started_at: "2026-10-05T17:59:15.288Z"
completed_at: "2026-10-05T18:01:02.878Z"
---

# docs: Folders… overlay to edit per-project doc folders

## Problem Statement

Users need a UI to add/remove configured folders per project, reusing the existing overlay pattern.

## Acceptance Criteria

- [x] Overlay lists current folders with a remove button each, an Add button that opens the native picker clamped to the project, and a Save that calls docs:folders-set
- [x] A save error (e.g. unknown project) shows inline in the overlay and keeps it open; Esc/close cancels without saving; saving an empty list falls back to defaults with a hint shown
- [REJECTED] [VISUAL] Overlay matches the existing 'Manage prompts' overlay in both light and dark themes (Visual check deferred to the story 010 real-app run (both themes); overlay is only reachable once 008 wires the Folders… menu item)
- [x] VERIFY: node --test test/renderer-contract.test.mjs

## Files

- renderer/docs-folders.js
- renderer/index.html
- renderer/dom.js
- renderer/style.css

## Proof

- [x] [completeness] Completeness (renderer/docs-folders.js （list, remove, Add via docs:pick-folder, Save via docs:folders-set, inline error, cancel/Esc/backdrop）, #docs-folders markup, dom.js refs; contract test RED （7 missing IDs） then GREEN; npm test 325/325)
- [~] [feature-availability] Feature availability (Reachable once story 008 adds the Folders… menu item; exercised in the story 010 real-app run)
- [x] [robustness] Robustness (session counter drops a picker/save result that lands after close; IPC rejections become inline errors; Save disabled while in flight （code review of docs-folders.js）)
- [x] [resilience] Resilience (a failed save keeps the overlay open with the draft intact; nothing is persisted until main accepts the list)
- [x] [security] Security (folder names rendered via textContent only; icons are trusted literals; validation stays in main （normalizeFolders + pick-folder clamp）)
- [~] [defense-in-depth] Defense in depth (UI layer; main re-validates every save （story 007）)
- [x] [input-validation] Input validation (case-insensitive duplicate add rejected inline; main's normalizeFolders error （e.g. archive folder） shown inline on save)
- [~] [thread-safety] Thread safety (Single renderer thread; stale async results dropped by the session counter)
- [x] [configurability] Configurability (this overlay is the per-project config UI; empty list = defaults （hint text in markup）)

## QA

- [ ] Folders overlay matches Manage prompts in light and dark themes (checked in story 010 run)

## Work Log


### 2026-10-05T18:00:45.073Z - Proof completeness set PROVEN: renderer/docs-folders.js (list, remove, Add via docs:pick-folder, Save via docs:folders-set, inline error, cancel/Esc/backdrop), #docs-folders markup, dom.js refs; contract test RED (7 missing IDs) then GREEN; npm test 325/325

### 2026-10-05T18:00:46.643Z - Proof feature-availability set NOT_APPLICABLE: Reachable once story 008 adds the Folders… menu item; exercised in the story 010 real-app run

### 2026-10-05T18:00:48.168Z - Proof robustness set PROVEN: session counter drops a picker/save result that lands after close; IPC rejections become inline errors; Save disabled while in flight (code review of docs-folders.js)

### 2026-10-05T18:00:49.718Z - Proof resilience set PROVEN: a failed save keeps the overlay open with the draft intact; nothing is persisted until main accepts the list

### 2026-10-05T18:00:51.335Z - Proof security set PROVEN: folder names rendered via textContent only; icons are trusted literals; validation stays in main (normalizeFolders + pick-folder clamp)

### 2026-10-05T18:00:52.887Z - Proof defense-in-depth set NOT_APPLICABLE: UI layer; main re-validates every save (story 007)

### 2026-10-05T18:00:54.533Z - Proof input-validation set PROVEN: case-insensitive duplicate add rejected inline; main's normalizeFolders error (e.g. archive folder) shown inline on save

### 2026-10-05T18:00:56.052Z - Proof thread-safety set NOT_APPLICABLE: Single renderer thread; stale async results dropped by the session counter

### 2026-10-05T18:00:57.577Z - Proof configurability set PROVEN: this overlay is the per-project config UI; empty list = defaults (hint text in markup)

### 2026-10-05T18:00:59.089Z - Completed: renderer/docs-folders.js (openFoldersDialog), #docs-folders overlay markup reusing .pm-list/.pm-card, dom.js refs, .df-* styles (tokens only). RED: contract test listed 7 missing IDs; GREEN after markup. npm test 325/325, typecheck clean, node --check ok. Not yet imported: story 008 wires it from the header menu. Visual criterion deferred to 010.

