---
status: completed
approved_at: "2026-10-05T17:44:21.835Z"
updated: "2026-10-05T18:21:27.855Z"
started_at: "2026-10-05T17:46:50.056Z"
completed_at: "2026-10-05T18:21:27.854Z"
---
# Plan: Docs management in the Docs panel

**Created:** 2026-10-05 | **Status:** Draft | **Effort:** M | **Branch:** feat/docs-management
**Spec:** `plans/20261005-docs-management.md` (approved brainstorm)

## Summary
Make the Docs panel manage docs: per-project folder config on the app's project/workspace records, plus Archive/Restore, Open in editor, Reveal and Recycle Bin on the shown doc (header ⋮). Config is removed with the record when a project or workspace is forgotten.

## Architecture Context
- Flow: `docs-panel.js` → `window.api.listDocs/readDoc` (`preload.js:41`) → `main.js:933` (gated by `isKnownDir`, `main.js:205`) → `docs.js` (Electron-free).
- Agents carry `dir` (project root = config key) and `cwd` (worktree = where files live), `renderer/state.js:111`.
- Records: `projects.json` / `workspaces.json` via `loadProjects`/`saveProjects` (`main.js:133-174`, atomic `persistStore`). `enrich` spreads records (`main.js:946`).
- Removal: `dashboard.js:240-271` removes agents, then `projects:remove` / `workspaces:remove` (`main.js:666`, `:700`) filter the record → `docFolders` gone.
- `openMenu` (`modals.js:10`) appends to `<body>`; a document click listener closes it, so the opener must `stopPropagation()` (as `sidebar.js:183`).
- Overlay pattern: "Manage prompts" (`index.html:386`, `renderer/prompts.js`).
- ADR: folder config in app records, not a repo file — trusted input, free cleanup, no repo pollution — rejected `.commandcenter.json`.

## Research Findings
- Tests pin `listDocs(cwd)`, `readDoc(cwd, rel)` and `kind` (`test/docs.test.js:39`, `test/docs-view.test.mjs:22`). `folders` arg defaults to `['plans','reviews']` so guard tests stay valid; `kind` → `folder`.
- Phone app does not use the docs API.
- `fs.rename` on Windows replaces an existing target: pick the free name right before rename (accepted TOCTOU, single user).
- `openInVSCode(path)` (`editors.js:92`) takes a file path, refuses `"`.
- Symlink tests skip here (EPERM without Developer Mode).

## Security Considerations
- `resolveDoc` is the one guard for read and every action: configured folder, separator-free name, `.md`/`.html`, realpath(folder) inside realpath(cwd), realpath(file) inside folder or its `archive/`.
- `normalizeFolders` rejects absolute, drive, UNC, `..`/`.` segments, `\0`, last segment `archive` (stops `plans` + `plans/archive` aliasing). Re-run on every read.
- `docs:list|read|action|pick-folder` gate on `isKnownDir(cwd)`; `dir` is only a lookup key. `docs:folders-set` errors unless `dir` matches a record.
- Trash only via `shell.trashItem` (no permanent delete); open only via `openInVSCode`.

## Performance Considerations
- 1 s poll while open: ≤20 folders × 2 readdirs, `withFileTypes` skips dirs before `stat`; cap 500 per directory, 1000 total.
- `.` = root files only, never recursive.

## Steps

### Step 1: normalizeFolders
- **Test:** `test/docs.test.js` — accepts `plans`, `docs/api`, `.`; `docs\\api`→`docs/api`; `''`→`.`; rejects `..`, `a/../b`, `C:\\x`, `/abs`, `\\\\srv\\share`, `\0`, `archive`, `plans/archive`; case-insensitive dedupe; >20 → error; `[]` → defaults; non-array → error.
- **Implement:** `docs.js`
- **Code:**
```js
function normalizeFolders(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'Folders must be a list' };
  const out = [], seen = new Set();
  for (const raw of input) {
    if (typeof raw !== 'string') return { ok: false, error: 'Invalid folder' };
    let f = raw.trim().replace(/\\/g, '/').replace(/\/+$/, '').replace(/^\.\//, '') || '.';
    const segs = f.split('/');
    if (f.startsWith('/') || /^[a-z]:/i.test(f) || f.includes('\0') ||
        (f !== '.' && segs.some((s) => s === '' || s === '.' || s === '..'))) {
      return { ok: false, error: `Folder must be inside the project: ${raw}` };
    }
    if (segs.at(-1).toLowerCase() === 'archive') return { ok: false, error: 'archive/ folders are listed automatically' };
    if (!seen.has(f.toLowerCase())) { seen.add(f.toLowerCase()); out.push(f); }
  }
  if (out.length > MAX_FOLDERS) return { ok: false, error: `At most ${MAX_FOLDERS} folders` };
  return { ok: true, folders: out.length ? out : [...DEFAULT_FOLDERS] };
}
```
- **Validation:** `node --test test/docs.test.js`

### Step 2: record helpers + cleanup contract
- **Test:** `test/docs.test.js` — `docFoldersFor`: no field → defaults; corrupt → defaults + `invalid: true`; `dir` matches across case/separators on win32. `withDocFolders`: sets only the matching record, input untouched; defaults remove the field; unknown dir → `{ ok:false }`. **Cleanup:** after `records.filter((r) => r.dir !== dir)` → defaults; re-added `{ dir, name }` → defaults; same for a workspace record.
- **Implement:** `docs.js`
- **Code:**
```js
function docFoldersFor(records, dir) {
  const rec = records.find((r) => samePath(r.dir, dir));
  if (!rec || rec.docFolders === undefined) return { folders: [...DEFAULT_FOLDERS], invalid: false };
  const n = normalizeFolders(rec.docFolders);
  return n.ok ? { folders: n.folders, invalid: false } : { folders: [...DEFAULT_FOLDERS], invalid: true };
}
function withDocFolders(records, dir, folders) {
  if (!records.some((r) => samePath(r.dir, dir))) return { ok: false, error: 'Unknown project' };
  const isDefault = folders.join('\n') === DEFAULT_FOLDERS.join('\n');
  return { ok: true, records: records.map((r) => {
    if (!samePath(r.dir, dir)) return r;
    const { docFolders, ...rest } = r;
    return isDefault ? rest : { ...rest, docFolders: folders };
  }) };
}
```
- **Constraint:** `samePath` mirrors `normPath` (`main.js:192`): `path.resolve` + lowercase on win32.
- **Validation:** `node --test test/docs.test.js`

### Step 3: listDocs(cwd, folders)
- **Test:** `test/docs.test.js` — entries `{ rel, folder, archived, mtimeMs, size }`; `plans/archive/x.md` → `archived: true, folder: 'plans'`; `.` lists `README.md`, not `plans/a.md` or `node_modules/x.md`; root `archive/old.md` → `folder: '.', archived: true`; missing folder skipped; `docs` + `docs/api` both listed; no arg → plans/reviews only; 501 files → 500. Existing `kind` asserts → `folder`.
- **Implement:** `docs.js`
- **Code:**
```js
const relFor = (folder, archived, name) =>
  [folder === '.' ? '' : folder, archived ? 'archive' : '', name].filter(Boolean).join('/');

async function listDocs(cwd, folders = DEFAULT_FOLDERS) {
  const out = [];
  for (const folder of folders) for (const archived of [false, true]) {
    const dir = path.join(cwd, relFor(folder, archived, ''));
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    let n = 0;
    for (const e of ents) {
      if (n >= MAX_PER_DIR || out.length >= MAX_TOTAL) break;
      if (e.isDirectory() || !DOC_EXTS.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const st = await fs.promises.stat(path.join(dir, e.name));
        if (!st.isFile()) continue;
        out.push({ rel: relFor(folder, archived, e.name), folder, archived, mtimeMs: st.mtimeMs, size: st.size });
        n++;
      } catch { /* vanished */ }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
```
- **Validation:** `node --test test/docs.test.js`

### Step 4: resolveDoc + readDoc(cwd, folders, rel)
- **Test:** `test/docs.test.js` — existing rejection tests pass with `folders` undefined; `README.md` ok with `['.']`, rejected by default; `plans/sub/x.md` rejected; `plans/archive/x.md` ok; unconfigured folder rejected; configured folder symlinked outside `cwd` rejected (skip on EPERM); missing file → "no longer exists".
- **Implement:** `docs.js` — `readDoc` = `resolveDoc` + existing 2 MB cap + `marked`.
- **Code:**
```js
async function resolveDoc(cwd, folders = DEFAULT_FOLDERS, rel) {
  try {
    const parts = String(rel ?? '').split(/[\\/]/);
    const name = parts.pop();
    if (!name || name === '..' || /[:\0]/.test(name) || parts.includes('..')) return fail('Invalid file name');
    if (!DOC_EXTS.has(path.extname(name).toLowerCase())) return fail('Only .md and .html files can be opened');
    let folder = folders.find((f) => f === (parts.join('/') || '.'));
    let archived = false;
    if (!folder && parts.at(-1) === 'archive') {
      folder = folders.find((f) => f === (parts.slice(0, -1).join('/') || '.'));
      archived = !!folder;
    }
    if (!folder) return fail('File is outside the docs folders');
    const root = await fs.promises.realpath(cwd);
    const folderReal = await fs.promises.realpath(path.join(cwd, folder));
    if (!isInside(root, folderReal)) return fail('File is outside the docs folders');
    const dirPath = archived ? path.join(folderReal, 'archive') : folderReal;
    const file = await fs.promises.realpath(path.join(dirPath, name));
    if (!isInside(dirPath, file) || file === dirPath) return fail('File is outside the docs folders');
    return { ok: true, file, folder, archived, name, folderReal };
  } catch (e) {
    return fail(e && e.code === 'ENOENT' ? `${path.basename(String(rel))} no longer exists` : 'Could not open file');
  }
}
```
- **Validation:** `node --test test/docs.test.js`

### Step 5: archiveDoc / restoreDoc
- **Test:** `test/docs.test.js` — archive `plans/a.md` → `plans/archive/a.md`, creates `archive/`, returns new `rel`; clash → `a (2).md` then `a (3).md`, originals intact; archiving archived → error; restore mirrors it incl. clash; restore non-archived → error; missing → `{ ok:false }`; folder `.` (`README.md` ↔ `archive/README.md`).
- **Implement:** `docs.js`
- **Code:**
```js
async function moveDoc(cwd, folders, rel, toArchive) {
  const r = await resolveDoc(cwd, folders, rel);
  if (!r.ok) return r;
  if (r.archived === toArchive) return fail(toArchive ? 'Already archived' : 'Not archived');
  const destDir = toArchive ? path.join(r.folderReal, 'archive') : r.folderReal;
  try {
    await fs.promises.mkdir(destDir, { recursive: true });
    const name = await freeName(destDir, r.name); // "a.md", "a (2).md", … up to 999
    await fs.promises.rename(r.file, path.join(destDir, name));
    return { ok: true, rel: relFor(r.folder, toArchive, name) };
  } catch (e) {
    return fail(`Could not ${toArchive ? 'archive' : 'restore'} ${r.name}: ${e.message}`);
  }
}
```
- **Validation:** `node --test test/docs.test.js`

### Step 6: docs-view grouping helpers
- **Test:** `test/docs-view.test.mjs` — `groupDocs(list, folders)` in `folders` order, Archived right after its folder, empty omitted, input untouched; `folderLabel('.')`→`Root`, `plans`→`Plans`; `newestDoc` skips archived, null if only archived; `docsSignature` changes when `archived` flips. Fixture `doc()` → `{ folder, archived }`.
- **Implement:** `renderer/docs-view.mjs`
- **Code:**
```js
export const folderLabel = (f) => (f === '.' ? 'Root' : f[0].toUpperCase() + f.slice(1));
export function groupDocs(list, folders) {
  const groups = [];
  for (const folder of folders) for (const archived of [false, true]) {
    const docs = list.filter((d) => d.folder === folder && d.archived === archived).sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (docs.length) groups.push({ folder, archived, label: archived ? 'Archived' : folderLabel(folder), docs });
  }
  return groups;
}
export const newestDoc = (list) =>
  list.filter((d) => !d.archived).reduce((n, d) => (!n || d.mtimeMs > n.mtimeMs ? d : n), null);
```
- **Validation:** `node --test test/docs-view.test.mjs`

### Step 7: IPC wiring
- **Test:** none possible (Electron); `npm run typecheck` + Step 10.
- **Implement:** `main.js`, `preload.js`, `types/ipc.d.ts`
- **Code:**
```js
ipcMain.handle('docs:action', async (_e, { cwd, dir, rel, action } = {}) => {
  if (!isKnownDir(cwd)) return { ok: false, error: 'Unknown folder' };
  const folders = docFoldersForDir(dir); // docs.docFoldersFor over both stores; log.warn when invalid
  if (action === 'archive') return docs.archiveDoc(cwd, folders, rel);
  if (action === 'restore') return docs.restoreDoc(cwd, folders, rel);
  const r = await docs.resolveDoc(cwd, folders, rel);
  if (!r.ok) return r;
  if (action === 'open') { const o = await openInVSCode(r.file); return o.error ? { ok: false, error: o.error } : { ok: true }; }
  if (action === 'reveal') { shell.showItemInFolder(r.file); return { ok: true }; }
  if (action === 'trash') {
    try { await shell.trashItem(r.file); return { ok: true }; } catch (e) { return { ok: false, error: errMsg(e) }; }
  }
  return { ok: false, error: 'Unknown action' };
});
// docs:list {cwd, dir} → { folders, docs }; docs:read {cwd, dir, rel}
// docs:folders-set {dir, folders} → normalizeFolders, then withDocFolders on projects, else workspaces, else 'Unknown project'
// docs:pick-folder cwd → showOpenDialog({ defaultPath: cwd }); path.relative; reject '..'/absolute; '' → '.'
```
- **Constraint:** log actions at `info` with `rel` only, failures `warn`. Types: `Project.docFolders?: string[]`; `DocEntry { rel, folder, archived, mtimeMs, size }`; `DocList { folders, docs }`; `DocAction`; new `docAction`, `setDocFolders`, `pickDocFolder`.
- **Validation:** `npm run typecheck && npm test`

### Step 8: panel actions, grouping, cleanup
- **Test:** none (no DOM tests); logic covered by Steps 1-6.
- **Implement:** `renderer/docs-panel.js`, `renderer/index.html` (`#docs-actions` ⋮ in `.docs-head`), `renderer/dom.js`
- **Code:**
```js
els.docsActions.addEventListener('click', (e) => {
  e.stopPropagation(); // modals.js document click would close the menu at once
  const d = list.find((x) => x.rel === currentRel);
  const off = !d || busy;
  openMenu(els.docsActions, [
    d?.archived ? { label: 'Restore', disabled: off, action: () => runAction('restore') }
                : { label: 'Archive', disabled: off, action: () => runAction('archive') },
    { label: 'Open in editor', disabled: !d, action: () => runAction('open') },
    { label: 'Reveal in Explorer', disabled: !d, action: () => runAction('reveal') },
    { label: 'Folders…', action: () => openFoldersDialog(activeAgent(), folders, loadFolder) },
    { label: 'Move to Recycle Bin', danger: true, disabled: off, action: confirmTrash },
  ]);
});
async function runAction(action) {
  if (busy || !currentRel) return;
  busy = true;
  ++listReq; // drop in-flight poll results
  const c = cwd;
  const res = await window.api.docAction({ cwd: c, dir: activeAgent().dir, rel: currentRel, action })
    .catch((err) => ({ ok: false, error: err.message }));
  busy = false;
  if (c !== cwd || !open) return;
  if (!res.ok) await confirmDialog('Docs', res.error, { alert: true });
  if (res.ok && res.rel) remembered.set(c, res.rel);
  if (res.ok && action === 'trash') remembered.delete(c);
  loadFolder();
}
onAgentsChanged(() => {
  const live = new Set([...agents.values(), ...dormant.values()].map((a) => a.cwd));
  for (const k of remembered.keys()) if (!live.has(k)) remembered.delete(k);
});
```
- **Constraint:** `poll()` skips while `busy`; `pickDefault` uses `newestDoc`; Archived groups collapsed (toggle on group row), expanded while the filter has text; empty state "No documents in the configured folders" + Folders… link; calls pass `a.dir`.
- **Visual — requires human verification:** ⋮ is `.icon-btn`; Archived label in `--muted`; tokens only.
- **Validation:** `node --test test/renderer-contract.test.mjs test/renderer-tokens.test.mjs && npm run typecheck`

### Step 9: Folders… overlay
- **Test:** `test/renderer-contract.test.mjs` — new `dom.js` IDs exist in `index.html`.
- **Implement:** `renderer/docs-folders.js` (new), `renderer/index.html` (`#docs-folders` like `#prompts-mgr`), `renderer/dom.js`, `renderer/style.css`
- **Code:**
```js
export function openFoldersDialog(agent, current, onSaved) {
  let folders = [...current];
  const render = () => els.dfList.replaceChildren(...folders.map((f, i) => folderRow(f, () => { folders.splice(i, 1); render(); })));
  els.dfAdd.onclick = async () => {
    const p = await window.api.pickDocFolder(agent.cwd);
    if (p.error) return showError(p.error);
    if (p.rel && !folders.includes(p.rel)) { folders.push(p.rel); render(); }
  };
  els.dfSave.onclick = async () => {
    const r = await window.api.setDocFolders({ dir: agent.dir, folders });
    if (!r.ok) return showError(r.error); // inline #df-error, stays open
    close();
    onSaved();
  };
  render();
  els.dfOverlay.hidden = false;
}
```
- **Constraint:** names via `textContent`; Esc/✕ cancel; empty list saves defaults (hint text says so).
- **Visual — requires human verification:** matches "Manage prompts" in both themes.
- **Validation:** `node --test test/renderer-contract.test.mjs && npm test`

### Step 10: real-app check + docs
- **Test:** `run` skill, CDP, isolated `--user-data-dir`, fixture repo with a worktree.
- **Check:** Folders… add `docs` and `.`; archive (stays shown, in Archived); clash `(2)`; restore; trash → Recycle Bin; open in editor; reveal; worktree agent sees same folders; forget project → no record in `projects.json`; re-add → defaults.
- **Implement:** `README.md`, `PRODUCT.md`, `DESIGN.md` (⋮ menu, Archived group, Folders overlay).
- **Validation:** `npm test && npm run typecheck`; screenshots both themes in log.

## Acceptance Criteria
- [x] Folders… sets per-project folders, shared by all worktrees; defaults when unset.
- [x] Each folder lists direct `.md`/`.html` + collapsed Archived; `.` = root only.
- [x] Archive/Restore never overwrite; panel follows the moved doc.
- [x] Trash goes to Recycle Bin after danger confirm; failure leaves file + alerts.
- [x] Open in editor and Reveal work for the shown doc.
- [x] Forgetting a project/workspace leaves no `docFolders`; re-add = defaults (unit-tested).
- [x] Guard rejects unconfigured folders, `..`, absolute, other extensions, file or folder symlink escapes.
- [x] `npm test` and `npm run typecheck` pass.

## Checklist (non-TDD cleanup)
- [x] `types/ipc.d.ts` matches handlers
- [x] README / PRODUCT / DESIGN updated
- [x] No absolute paths in logs
- [x] Commit the needs-band fixes separately first

## Log
- 2026-10-05 Stories 001-009 — done (one commit each, `closes #<id>`). Unit tests 281 → 325, typecheck clean throughout.
  - Order changed: 009 (Folders overlay) before 008 (panel menu) so the Folders… item had a real target.
  - Added beyond the plan: the destination `archive/` is realpath-checked after mkdir (an `archive` junction could move a file out of the project; test + mutation check); `docs:action` dispatch moved into `docs.docAction` with injected OS calls because `npm run typecheck` only covers `preload.js` vs `types/ipc.d.ts`, not `main.js` or the renderer (5 tests); log lines redact quoted fs paths.
- 2026-10-05 Step 10 — real app, driven over CDP (`scripts/e2e-docs/`), isolated `--user-data-dir`, throwaway HOME, fixture repo + linked worktree.
  - Passed: panel opens on the newest doc; default groups Plans / Archived (2, collapsed) / Reviews; ⋮ menu items and danger styling; Folders… overlay lists folders, removing a row + Save writes `docFolders: ["plans"]` to `projects.json` and reloads the panel; Cancel saves nothing; `docs:folders-set` rejects `plans/archive`, `../..` and an unknown dir; with `plans, reviews, docs, .` the picker shows Plans / Archived / Reviews / Docs / Root; Archived toggle expands with muted rows; archiving `plans/a.md` with `plans/archive/a.md` present gives `plans/archive/a (2).md`, the panel follows it and opens Archived; Restore moves it back (keeps the `(2)` name); Move to Recycle Bin asks first with Cancel focused, the file is in the Recycle Bin with its original folder, the panel falls back to the newest doc; Open in VS Code launched `Code.exe <repo>\README.md`; Show in Explorer logged ok; the worktree agent uses the project's folders with its own files; the dashboard closes the panel; empty state + Choose folders… opens the overlay; Forget project leaves `projects.json` = `[]`; a re-added record (`{dir, name}`) shows the defaults; light and dark screenshots of picker, Archived, menu, overlay, empty state.
  - Fixed during the run: Add folder icon sat above its label (`.btn-ghost` is not a flex box) → `#df-add` inline-flex; re-checked in both themes.
  - Main log lines: `docs archive plans/a.md`, `docs restore plans/archive/a (2).md`, `docs trash plans/a (2).md`, `docs open README.md`, `docs reveal README.md` — relative paths only.

## Not proven
- **Add folder through the native folder picker**: CDP cannot drive the OS dialog. The `docs:pick-folder` clamp (reject outside cwd, `''` → `.`) is code-reviewed only; folders were added through the same `setDocFolders` IPC that Save uses.
- **Re-add through the dashboard**: same native dialog; simulated by writing the record `addProjectDir` writes.
- **The 1 s poll picking up an external config change**: the test window was hidden (screen locked), and the poll pauses by design while hidden; reopening the panel showed the change. Doc edits on disk were already proven live in `plans/docs-viewer-panel.md`.
- **A failed trash / rename alert** (locked file, no Recycle Bin): unit-tested in `docs.docAction` / `moveDoc`, not provoked in the real app.
- **Workspaces**: config + cleanup are unit-tested on workspace-shaped records; no workspace was used in the real-app run.
