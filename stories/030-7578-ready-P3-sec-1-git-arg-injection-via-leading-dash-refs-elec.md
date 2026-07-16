---
id: 030-7578
title: [SEC-1] Git arg injection via leading-dash refs + Electron hardening cluster
status: ready
priority: P3
type: fix
created: "2026-07-16T22:38:16.368Z"
updated: "2026-07-16T22:38:41.434Z"
dependencies: []
---

# [SEC-1] Git arg injection via leading-dash refs + Electron hardening cluster

## Problem Statement

Defense-in-depth cluster (all confirmed real, low current blast radius). SEC-1(conf60 validated): hasShellMeta (jsonstore.js:79) does not reject a leading dash; a remote branch named -x flows unguarded into git worktree add -b <branch> and git branch -d. SEC-2(55): IPC handlers act on renderer dir/cwd without checking it is registered. SEC-3(60): hook server has no socket timeout. SEC-4(65): latent innerHTML sink in openMenu (modals.js:20). SEC-5(50): no explicit sandbox:true / setWindowOpenHandler / will-navigate guard.

## Acceptance Criteria

- [ ] Insert -- before positional git ref/base args (and/or reject leading dash in ref names)
- [ ] Validate incoming dir/cwd against loadProjects/loadWorkspaces/agents before acting
- [ ] server.setTimeout on the hook server
- [ ] openMenu builds icon as DOM node, label via textContent
- [ ] Add sandbox:true, setWindowOpenHandler(deny), will-navigate guard

## Files

- main.js
- jsonstore.js
- renderer/modals.js

## Work Log

