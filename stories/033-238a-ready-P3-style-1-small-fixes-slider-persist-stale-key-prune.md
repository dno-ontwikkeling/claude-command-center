---
id: 033-238a
title: "[STYLE-1] Small fixes: slider persist, stale-key prune, case path, eventHasReport, sidebar"
status: ready
priority: P3
type: fix
created: "2026-07-16T22:38:16.370Z"
updated: "2026-07-16T22:38:41.781Z"
dependencies: []
---

# [STYLE-1] Small fixes: slider persist, stale-key prune, case path, eventHasReport, sidebar

## Problem Statement

Low-risk independent nits. STYLE-1(conf85): volume slider saveSettings() on every input drag tick (settings.js:202-205) vs change elsewhere. STYLE-6(55): collapsedProjects localStorage never pruned on removal - permanent stale-key growth. BUG-6(55): case-sensitive path dedup (main.js:530,570) registers the same Windows folder twice. BUG-5(55): eventHasReport uses a fragile substring includes('report.js') (hookauth.js:28-32). PERF-4(55): sidebar full-rebuild + O(PxA) rescans on every lifecycle event.

## Acceptance Criteria

- [ ] Volume slider persists on change not per-tick
- [ ] collapsedProjects entry deleted on project/workspace removal
- [ ] Path dedup normalizes case
- [ ] eventHasReport matches the resolved REPORT_SCRIPT path
- [ ] (optional) sidebar row-level patch instead of full rebuild

## Files

- renderer/settings.js
- renderer/sidebar.js
- main.js
- hookauth.js

## Work Log

