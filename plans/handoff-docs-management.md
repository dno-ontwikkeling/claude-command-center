# Handoff: docs management (branch `feat/docs-management`)

Date: 2026-10-05. Written at the end of an unattended session so you can pick
this up on another PC. Branch is pushed to `origin` (your fork) only; nothing
was pushed to `upstream` and no PR was opened.

## State

**Done, all committed, tests green.** `npm test` 325/325 (was 281), `npm run
typecheck` clean. All 10 stories complete; plan `plans/docs-management.md`
auto-closed with its Log and a "Not proven" section.

Branch commits on top of `main` (oldest first):

1. `fix(sidebar)` — the two bugs you reported: agents waiting for input stay
   listed in the project/workspace list, and the Needs-you band clears as soon
   as you answer in the terminal (Enter, Esc, a menu digit, y/n). Not part of
   the docs feature; separate commit so you can cherry-pick it to `main` alone.
2. `docs(plans)` — brainstorm decision (`plans/20261005-docs-management.md`),
   implementation plan, stories.
3. Nine `feat(docs)` commits, one per story (001-009).
4. `docs(docs-panel)` — real-app verification, README / PRODUCT / DESIGN, e2e
   helpers in `scripts/e2e-docs/` (story 010).

## What the feature does

- Per-project (and per-workspace) Docs folders, stored as `docFolders` on the
  record in `userData/projects.json` / `workspaces.json`. Default
  `plans` + `reviews`. `.` = project root (non-recursive). Every worktree of a
  project shares the list. Forgetting the project drops it with the record;
  nothing is ever written into the repo.
- Each folder's `archive/` is listed as a collapsed **Archived** group.
- Header **⋮** menu on the shown doc: Archive / Restore, Open in VS Code, Show
  in Explorer, Folders…, Move to Recycle Bin (confirm, Cancel focused).
- One path guard (`docs.resolveDoc`) for every read and action: configured
  folder only, `.md`/`.html`, realpath nesting cwd → folder → archive → file.

## Please check by hand (could not be automated)

- **Add folder** in the Folders overlay opens a native folder dialog that CDP
  cannot drive. The save path was proven through the UI; folders were added via
  the same IPC. Try: ⋮ → Folders… → Add folder → pick `docs` → Save.
  Also try picking a folder outside the project (should show an inline error)
  and the project root itself (should appear as "Project root").
- **Re-add a forgotten project** from the dashboard, confirm it shows only
  Plans and Reviews.
- Optional: a **workspace** (not a git project) — config and cleanup are
  unit-tested on workspace records, but no workspace was used in the real run.

## Decisions made without you (easy to revert)

- Header ⋮ instead of a per-row ⋮ in the picker (you chose this in planning).
- **Restore keeps a clash suffix**: archiving `a.md` next to an existing
  `archive/a.md` makes `archive/a (2).md`; restoring it gives `plans/a (2).md`,
  not `a.md`. Never overwrites; renaming is out of scope.
- Folder names ending in `archive` are rejected (the archive group would list
  the same files twice).
- Caps: 20 folders, 500 docs per directory, 1000 in total (1 s poll cost).
- `docs:action` dispatch lives in `docs.js` (`docAction`) with the Electron
  calls injected, because `npm run typecheck` only checks `preload.js` against
  `types/ipc.d.ts`, not `main.js` or the renderer.

## Things noticed on the way (not fixed)

- `npm run typecheck` does not cover `main.js` or `renderer/*`
  (`tsconfig.typecheck.json` lists only `preload.js` + `types/ipc.d.ts`).
  Widening it is a separate task.
- When the app runs with `--remote-debugging-port`, a VS Code window started
  from "Open in VS Code" inherits the devtools socket, so the port stays taken
  after the app quits. Dev-only; documented in `scripts/e2e-docs/README.md`.
- The stories CLI's VERIFY step fails on Windows for `npm …` commands
  (`spawnSync npm ENOENT`, it needs `npm.cmd` or a shell). Tests were run
  manually each time.
- `node_modules/electron/dist` was missing in this checkout; I ran
  `node node_modules/electron/install.js` to fetch the binary (same as
  `npm start` does on first run).

## Not committed on purpose

- Your `.gitignore` edit (`.codex/**`, `.mdkb/**`) — left as an uncommitted
  change on the first PC.
- `.wiz/` (local tooling scratch).

## Next steps

1. Pull the branch: `git fetch origin && git switch feat/docs-management`.
2. `npm install` (if needed), `npm test`, `npm start`; do the manual checks above.
3. Merge or open a PR when happy. The `fix(sidebar)` commit can go to `main`
   on its own first if you want it sooner.
4. Delete this handoff file before merging (or keep it as history).
