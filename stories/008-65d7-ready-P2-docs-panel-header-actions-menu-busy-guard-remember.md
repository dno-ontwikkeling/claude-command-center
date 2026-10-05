---
id: 008-65d7
title: "docs: panel header actions menu, busy guard, remembered-doc cleanup"
status: ready
priority: P2
type: feature
created: "2026-10-05T17:44:21.898Z"
updated: "2026-10-05T17:59:13.278Z"
dependencies: ["006-96ea", "007-4ec2"]
plan: plans/docs-management.md
plan_step: Step 8
depends_on: ["stories/006-96ea-pending-P2-docs-groupdocs-folderlabel-newestdoc-picker-helper.md", "stories/007-4ec2-pending-P2-docs-ipc-wiring-for-folders-config-and-doc-actions.md"]
started_at: "2026-10-05T17:59:05.446Z"
---

# docs: panel header actions menu, busy guard, remembered-doc cleanup

## Problem Statement

The panel needs a header action menu for the shown doc, must not race its own 1s poll, and must not leak remembered-doc state after an agent is gone.

## Acceptance Criteria

- [ ] A header kebab opens archive/restore, open in editor, reveal, Folders..., and move to Recycle Bin (danger, confirmed) for the currently shown doc; it stops propagation so the picker popup does not close itself first
- [ ] An action in flight sets a busy flag: the 1s poll is skipped and the menu's mutating items are disabled until it resolves; after success the panel re-lists immediately and follows the moved doc, or the newest doc otherwise
- [ ] remembered (cwd -> last shown doc) is pruned on every agents-changed event against the live set of agent cwds, so a removed project/workspace/worktree never leaves a stale entry
- [ ] [VISUAL] Archived group renders muted and collapsed by default, expanded while the filter has text; empty state reads 'No documents in the configured folders' with a Folders... link
- [ ] VERIFY: node --test test/renderer-contract.test.mjs test/renderer-tokens.test.mjs

## Files

- renderer/docs-panel.js
- renderer/index.html
- renderer/dom.js

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

