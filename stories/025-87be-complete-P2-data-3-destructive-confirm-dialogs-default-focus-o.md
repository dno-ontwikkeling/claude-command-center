---
id: 025-87be
title: [DATA-3] Destructive confirm dialogs default-focus OK and Enter-confirm
status: complete
priority: P2
type: fix
created: "2026-07-16T22:38:16.363Z"
updated: "2026-07-16T22:48:09.382Z"
dependencies: []
completed_at: "2026-07-16T22:48:09.382Z"
---

# [DATA-3] Destructive confirm dialogs default-focus OK and Enter-confirm

## Problem Statement

confirmDialog (modals.js:100-140) always confirmOk.focus() and binds a document-level Enter->done(true) even when opts.danger is true (delete worktree, force-delete branch, remove workspace). danger only toggles a CSS class. In a terminal-heavy UI where Enter is the most-pressed key a stray/queued Enter confirms a destructive action. Validated conf72.

## Acceptance Criteria

- [x] For danger variants focus Cancel by default
- [x] Scope the Enter keydown handler to the overlay not document

## Files

- renderer/modals.js

## Work Log

### 2026-07-16T22:48:09.148Z - Wave 1: implemented; 62 tests + typecheck green

