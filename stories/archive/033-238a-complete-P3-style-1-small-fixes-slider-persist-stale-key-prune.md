---
id: 033-238a
title: "[STYLE-1] Small fixes: slider persist, stale-key prune, case path, eventHasReport, sidebar"
status: complete
priority: P3
type: fix
created: "2026-07-16T22:38:16.370Z"
updated: "2026-07-16T23:36:06.050Z"
dependencies: []
completed_at: "2026-07-16T23:36:06.050Z"
---

# [STYLE-1] Small fixes: slider persist, stale-key prune, case path, eventHasReport, sidebar

## Problem Statement

Low-risk independent nits. STYLE-1(conf85): volume slider saveSettings() on every input drag tick (settings.js:202-205) vs change elsewhere. STYLE-6(55): collapsedProjects localStorage never pruned on removal - permanent stale-key growth. BUG-6(55): case-sensitive path dedup (main.js:530,570) registers the same Windows folder twice. BUG-5(55): eventHasReport uses a fragile substring includes('report.js') (hookauth.js:28-32). PERF-4(55): sidebar full-rebuild + O(PxA) rescans on every lifecycle event.

## Acceptance Criteria

- [x] Volume slider persists on change not per-tick
- [x] collapsedProjects entry deleted on project/workspace removal
- [x] Path dedup normalizes case
- [x] eventHasReport matches the resolved REPORT_SCRIPT path
- [REJECTED] (optional) sidebar row-level patch instead of full rebuild (PERF-4 sidebar row-level patch deferred: full-rebuild rewrite too invasive for a low-risk cluster; revisit standalone)

## Files

- renderer/settings.js
- renderer/sidebar.js
- main.js
- hookauth.js

## Work Log

### 2026-07-16T23:36:05.811Z - STYLE-1 persist-on-change, STYLE-6 prune collapsed, BUG-6 case-insensitive dedup, BUG-5 match resolved REPORT_SCRIPT (+neg test); PERF-4 deferred; 82 pass

