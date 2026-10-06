---
id: 008-65d7
title: "docs: panel header actions menu, busy guard, remembered-doc cleanup"
status: complete
priority: P2
type: feature
created: "2026-10-05T17:44:21.898Z"
updated: "2026-10-05T18:03:32.927Z"
dependencies: ["006-96ea", "007-4ec2"]
plan: plans/docs-management.md
plan_step: Step 8
depends_on: ["stories/006-96ea-pending-P2-docs-groupdocs-folderlabel-newestdoc-picker-helper.md", "stories/007-4ec2-pending-P2-docs-ipc-wiring-for-folders-config-and-doc-actions.md"]
started_at: "2026-10-05T18:01:09.564Z"
completed_at: "2026-10-05T18:03:32.926Z"
---

# docs: panel header actions menu, busy guard, remembered-doc cleanup

## Problem Statement

The panel needs a header action menu for the shown doc, must not race its own 1s poll, and must not leak remembered-doc state after an agent is gone.

## Acceptance Criteria

- [x] A header kebab opens archive/restore, open in editor, reveal, Folders..., and move to Recycle Bin (danger, confirmed) for the currently shown doc; it stops propagation so the picker popup does not close itself first
- [x] An action in flight sets a busy flag: the 1s poll is skipped and the menu's mutating items are disabled until it resolves; after success the panel re-lists immediately and follows the moved doc, or the newest doc otherwise
- [x] remembered (cwd -> last shown doc) is pruned on every agents-changed event against the live set of agent cwds, so a removed project/workspace/worktree never leaves a stale entry
- [REJECTED] [VISUAL] Archived group renders muted and collapsed by default, expanded while the filter has text; empty state reads 'No documents in the configured folders' with a Folders... link (Visual check (muted collapsed Archived group, empty state) deferred to the story 010 real-app run in both themes)
- [x] VERIFY: node --test test/renderer-contract.test.mjs test/renderer-tokens.test.mjs

## Files

- renderer/docs-panel.js
- renderer/index.html
- renderer/dom.js

## Proof

- [x] [completeness] Completeness (docs-panel.js: header ⋮ menu （archive/restore, open, reveal, Folders…, trash）, runAction with busy guard, confirmTrash, editFolders, Archived toggle + filter expand, empty-state Folders link, onAgentsChanged prune; contract test RED （3 IDs） then GREEN; npm test 325/325)
- [~] [feature-availability] Feature availability (UI wired; end-to-end exercise is the story 010 real-app run)
- [x] [robustness] Robustness (runAction: busy reset in finally; result dropped if agent switched or panel closed; on failure alert + re-list so a vanished file is reflected)
- [x] [resilience] Resilience (++listReq at action start drops a stale in-flight poll; poll（） returns early while busy)
- [x] [security] Security (trash needs a danger confirm （Cancel focused by default per confirmDialog）; renderer sends only cwd/dir/rel/action, main guards everything; labels via textContent)
- [~] [defense-in-depth] Defense in depth (UI layer; all checks live in main （stories 004/005/007）)
- [~] [input-validation] Input validation (No user text input added; rel comes from docs:list)
- [x] [thread-safety] Thread safety (busy flag serializes actions; listReq/docReq counters drop stale async results)
- [x] [configurability] Configurability (Folders… menu item and empty-state link open the per-project folders overlay; panel re-lists after save)

## QA

- [ ] Archived group muted + collapsed, empty state, ⋮ menu in light and dark themes (checked in story 010 run)

## Work Log


### 2026-10-05T18:03:15.954Z - Proof completeness set PROVEN: docs-panel.js: header ⋮ menu (archive/restore, open, reveal, Folders…, trash), runAction with busy guard, confirmTrash, editFolders, Archived toggle + filter expand, empty-state Folders link, onAgentsChanged prune; contract test RED (3 IDs) then GREEN; npm test 325/325

### 2026-10-05T18:03:17.392Z - Proof feature-availability set NOT_APPLICABLE: UI wired; end-to-end exercise is the story 010 real-app run

### 2026-10-05T18:03:18.862Z - Proof robustness set PROVEN: runAction: busy reset in finally; result dropped if agent switched or panel closed; on failure alert + re-list so a vanished file is reflected

### 2026-10-05T18:03:20.286Z - Proof resilience set PROVEN: ++listReq at action start drops a stale in-flight poll; poll() returns early while busy

### 2026-10-05T18:03:21.714Z - Proof security set PROVEN: trash needs a danger confirm (Cancel focused by default per confirmDialog); renderer sends only cwd/dir/rel/action, main guards everything; labels via textContent

### 2026-10-05T18:03:23.273Z - Proof defense-in-depth set NOT_APPLICABLE: UI layer; all checks live in main (stories 004/005/007)

### 2026-10-05T18:03:24.807Z - Proof input-validation set NOT_APPLICABLE: No user text input added; rel comes from docs:list

### 2026-10-05T18:03:26.236Z - Proof thread-safety set PROVEN: busy flag serializes actions; listReq/docReq counters drop stale async results

### 2026-10-05T18:03:27.645Z - Proof configurability set PROVEN: Folders… menu item and empty-state link open the per-project folders overlay; panel re-lists after save

### 2026-10-05T18:03:29.071Z - Completed: #docs-actions ⋮ menu + archive icon, runAction (busy guard, follow moved doc, trash falls back to newest), confirmTrash, editFolders -> openFoldersDialog, collapsible Archived groups (keyboard + click, open while filtering, auto-open for the shown archived doc), empty-state Folders link, remembered pruned on onAgentsChanged. RED: contract test 3 missing IDs; GREEN after markup. npm test 325/325, typecheck clean, node --check ok. Done 009 before 008 so the Folders… item had a real target. Visual criterion deferred to 010.

