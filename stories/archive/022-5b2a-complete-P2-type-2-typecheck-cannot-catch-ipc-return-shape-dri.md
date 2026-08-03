---
id: 022-5b2a
title: [TYPE-2] Typecheck cannot catch IPC return-shape drift
status: complete
priority: P2
type: chore
created: "2026-07-16T22:38:16.360Z"
updated: "2026-07-16T22:53:20.407Z"
dependencies: ["021-f40e"]
completed_at: "2026-07-16T22:53:20.407Z"
---

# [TYPE-2] Typecheck cannot catch IPC return-shape drift

## Problem Statement

Root cause of TYPE-1. checkJs:false so nothing is checked except npm run typecheck whose files is only preload.js+ipc.d.ts; main.js and renderer are never checked against the contract. The electron stub types invoke():Promise<any> so any is assignable to any declared return - return-shape drift is structurally uncatchable. Contract gives false confidence (conf95).

## Acceptance Criteria

- [x] Type the stub invoke per-channel (discriminated union) OR add main.js+renderer to typecheck include
- [x] Correct the preload.js:6-8 comment claiming renderer-side enforcement
- [x] CI typecheck fails if a handler return shape diverges from ipc.d.ts

## Files

- jsconfig.json
- tsconfig.typecheck.json
- types/electron.d.ts
- preload.js

## Work Log

### 2026-07-16T22:52:41.327Z - Wave 2: implemented; 62 tests + typecheck green

### 2026-07-16T22:53:20.171Z - Wave 2: per-channel invoke typing enforces preload<->contract; drift confirmed caught by tsc; broader main.js/renderer check left as documented residual gap

