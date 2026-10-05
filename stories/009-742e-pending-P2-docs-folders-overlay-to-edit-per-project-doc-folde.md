---
id: 009-742e
title: "docs: Folders… overlay to edit per-project doc folders"
status: pending
priority: P2
type: feature
created: "2026-10-05T17:44:21.900Z"
updated: "2026-10-05T17:44:57.661Z"
dependencies: ["007-4ec2"]
plan: plans/docs-management.md
plan_step: Step 9
depends_on: ["stories/007-4ec2-pending-P2-docs-ipc-wiring-for-folders-config-and-doc-actions.md"]
---

# docs: Folders… overlay to edit per-project doc folders

## Problem Statement

Users need a UI to add/remove configured folders per project, reusing the existing overlay pattern.

## Acceptance Criteria

- [ ] Overlay lists current folders with a remove button each, an Add button that opens the native picker clamped to the project, and a Save that calls docs:folders-set
- [ ] A save error (e.g. unknown project) shows inline in the overlay and keeps it open; Esc/close cancels without saving; saving an empty list falls back to defaults with a hint shown
- [ ] [VISUAL] Overlay matches the existing 'Manage prompts' overlay in both light and dark themes
- [ ] VERIFY: node --test test/renderer-contract.test.mjs

## Files

- renderer/docs-folders.js
- renderer/index.html
- renderer/dom.js
- renderer/style.css

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

