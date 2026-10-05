# Feature: Docs management in the Docs panel
Date: 2026-10-05
Status: Approved

## Problem
The Docs panel (`plans/docs-viewer-panel.md`) is read-only and only sees direct children of `<cwd>/plans` and `<cwd>/reviews`. Cleaning up old plans and reviews happens by hand outside the app (commit `22c6a5d` deleted four reviews through git), `plans/archive/` exists but the panel cannot see it, and root docs (`README.md`, `DESIGN.md`, `PRODUCT.md`) or a `docs/` folder cannot be shown at all.

## Decision
Two additions to the existing panel:

1. **Per-project folder config, stored in the app (Option A).** An optional `docFolders: string[]` field on each record in `userData/projects.json` and `workspaces.json`, keyed by the project `dir` so all worktrees of a project share it. Missing or empty means `["plans", "reviews"]` (today's behaviour). Edited from a "Folders…" overlay in the panel header (list, Add via native folder picker clamped inside the project, Remove).
2. **Lifecycle actions per doc.** A ⋮ menu on each picker row: Archive (move to `<folder>/archive/`) / Restore, Open in editor, Reveal in Explorer, Move to Recycle Bin (with confirm).

Each configured folder lists its direct `.md`/`.html` files plus its `archive/` subfolder as a collapsed "Archived" group. `.` means root files only, never recursive.

### Cleanup on project / workspace removal
- `docFolders` lives on the record, so `projects:remove` / `workspaces:remove` drop it with the record. No separate store, no orphans. Re-adding the project starts on defaults. A unit test locks this in.
- The renderer's in-memory remembered-doc map is pruned on `onAgentsChanged`: any `cwd` no longer owned by an agent is dropped (covers project remove, workspace remove, worktree delete, agent forget).
- An orphan agent that outlives its project falls back to the default folders.
- Files on disk (`archive/` folders, moved docs) are never touched by cleanup. They are user data.

## Alternatives Considered
- **B: repo-side `.commandcenter.json`.** Versioned and shared with the team, but drops a file into every customized repo, is untrusted input to the path guard, and cleanup on project removal would either dirty the git tree or delete shared config. Rejected.
- **C: hybrid (repo file wins, app fallback).** Two sources of truth and roughly double the code and tests for no current need. Rejected (YAGNI).
- **Fixed convention, no config.** Simplest, but the user wants per-project control.
- **Whole-repo scan.** Noisy list and slow polling on large repos. Rejected.

## Implementation Notes

### Data model
```ts
interface ProjectRecord   { dir: string; name: string; docFolders?: string[] }
interface WorkspaceRecord { /* existing fields */ docFolders?: string[] }

interface DocEntry {
  rel: string;       // relative to cwd, '/' separated: "plans/x.md", "plans/archive/x.md", "README.md"
  folder: string;    // config entry it came from: "plans", "."
  archived: boolean; // true when it sits in <folder>/archive/
  mtimeMs: number;
  size: number;
}
type DocAction = 'archive' | 'restore' | 'trash' | 'open' | 'reveal';
type DocActionResult = { ok: true; rel?: string } | { ok: false; error: string };
```
- Stored form: normalized relative paths, `/` separators, `.` for root, no trailing slash, deduped, at most 20 entries. Defaults are never written, so untouched records stay byte-identical. No migration or schema version.
- `docFoldersFor` re-runs `normalizeFolders` on every read; a hand-corrupted entry (`"../.."`) falls back to defaults with `log.warn`.
- `enrich` spreads the record (`main.js:946`), so `docFolders` also reaches `state.projectsData` and the phone snapshot. Harmless; main stays the source of truth via IPC.
- `DocEntry.kind` is replaced by `folder` + `archived`. `docsSignature` includes `archived`.

### Components
**`docs.js`** (Electron-free, unit-tested)
- `normalizeFolders(input)` → `{ ok, folders } | { ok:false, error }`. Rejects absolute, drive-lettered, UNC, `..`, `\0`.
- `listDocs(cwd, folders)` — direct `.md`/`.html` per folder plus `<folder>/archive/`.
- `resolveDoc(cwd, folders, rel)` — the single path guard: `rel` must be `<folder>/<name>` or `<folder>/archive/<name>` for a configured folder, allowed extension, realpath inside `cwd/<folder>`. Every read and action goes through it.
- `readDoc(cwd, folders, rel)` — `resolveDoc` + existing 2 MB cap + `marked`.
- `archiveDoc` / `restoreDoc` — `resolveDoc`, `mkdir archive/`, `fs.rename`; name clash → `x (2).md`, never overwrite; no copy+delete fallback.
- `docFoldersFor(records, dir)` / `withDocFolders(records, dir, folders)` — pure record helpers so main.js only loads, calls and saves.

**`main.js`** (every handler gated by `isKnownDir`)
- `docs:list {cwd, dir}`, `docs:read {cwd, dir, rel}` gain `dir`.
- `docs:folders-get dir`, `docs:folders-set {dir, folders}` — normalize, save on the project or workspace record via the existing atomic `persistStore`.
- `docs:pick-folder {dir, cwd}` — native picker at `cwd`, reject outside `cwd`, return the relative path.
- `docs:action {cwd, dir, rel, action}` — archive/restore → `docs.js`; trash → `shell.trashItem`; open → `openInVSCode(file)`; reveal → `shell.showItemInFolder`.

**`preload.js`, `types/ipc.d.ts`** — new methods and types above.

**Renderer**
- `docs-view.mjs` — `groupDocs` groups by folder in config order, Archived group after each, `.` labelled "Root".
- `docs-panel.js` — ⋮ per row via `openMenu` (`modals.js:10`); trash confirms via `confirmDialog`; re-list right after an action; follow the moved doc or fall back to newest; disable the row menu while its action is in flight and ignore polls until it resolves (`listReq` guard); prune `remembered` on `onAgentsChanged`.
- `docs-folders.js` (new) — the Folders… overlay, reusing the `.overlay` markup and styles. Tokens only, per `DESIGN.md`.

### Error handling
- Nothing in `docs.js` throws; everything returns `{ ok:false, error }`. The renderer surfaces errors with `confirmDialog(title, error, { alert: true })` like `stage.js:116`.
- Unknown dir → "Unknown folder". Guard rejection → "File is outside the docs folders". Vanished file → "x.md no longer exists" + re-list. Rename or trash failure → alert with reason, file stays put, no permanent-delete fallback. VS Code CLI missing → existing `openInVSCode` message.
- Missing folders contribute nothing; all empty → "No documents in the configured folders" with a Folders… link.
- Corrupt `projects.json` → existing `warnCorruptOnce`; a folders save is aborted, never overwrites.
- Log each action at `info` (action, `rel`, outcome) and failures at `warn`, relative paths only.

### Testing
- `test/docs.test.js`: `normalizeFolders` (accept/normalize/reject/dedupe/cap/defaults); `listDocs` (archive group, `.` root-only, missing folder, nested config); `resolveDoc` (unconfigured folder, non-archive subfolder, `..`, backslash, extension, symlink escape — skipped without symlink rights); `archiveDoc`/`restoreDoc` (move, mkdir, `(2)`/`(3)` clash, already-archived rejected, missing file); `docFoldersFor`/`withDocFolders` (defaults, corrupt, survives reorder, **cleanup: record filtered out → defaults, re-add starts clean**, workspaces too).
- `test/docs-view.test.mjs`: grouping order, Archived placement, Root label, signature flips on `archived`, filter on name only.
- Existing renderer contract and token tests cover the new IDs and colours.
- Real-app run (`run` skill, CDP, isolated profile): add `docs` and `.`, archive/restore/clash/trash (check Recycle Bin), open in editor, reveal, remove project → `projects.json` has no `docFolders` for it → re-add shows defaults, orphan agent panel.
- Done: `npm test` and `npm run typecheck` green; every criterion ticked or listed as not proven with the reason.

### Out of scope (simplest version)
- Recursive folders, glob patterns, rename, create/edit docs, bulk actions, search inside docs, cross-agent docs view, phone app support, persisting collapsed state.
- Trash on the phone or from the dashboard.
