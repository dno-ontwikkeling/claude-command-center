---
id: 007-4ec2
title: "docs: IPC wiring for folders config and doc actions"
status: pending
priority: P2
type: feature
created: "2026-10-05T17:44:21.896Z"
updated: "2026-10-05T17:44:52.471Z"
dependencies: ["005-d7c6"]
plan: plans/docs-management.md
plan_step: Step 7
depends_on: ["stories/005-d7c6-pending-P2-docs-archivedoc-restoredoc-move-files-without-ever.md"]
---

# docs: IPC wiring for folders config and doc actions

## Problem Statement

The renderer needs IPC handlers to list/read docs with per-project folders, save folder config, and run archive/restore/trash/open/reveal, all gated on known directories.

## Acceptance Criteria

- [ ] docs:list {cwd,dir} returns {folders, docs}; docs:read {cwd,dir,rel} uses the project's configured folders; both reject an unknown cwd
- [ ] docs:folders-set {dir,folders} normalizes then saves onto the matching project or workspace record, or returns 'Unknown project'
- [ ] docs:action {cwd,dir,rel,action} handles archive/restore/open/reveal/trash, each going through resolveDoc first; trash uses shell.trashItem with no permanent-delete fallback; docs:pick-folder clamps the native picker inside cwd
- [ ] types/ipc.d.ts updated (Project.docFolders, DocEntry, DocList, DocAction, docAction/setDocFolders/pickDocFolder on Api)
- [ ] VERIFY: npm run typecheck

## Files

- main.js
- preload.js
- types/ipc.d.ts

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

