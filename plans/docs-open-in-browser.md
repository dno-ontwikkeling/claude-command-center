# Docs viewer: Open in browser

Base: 22c27852f8ba7098192e0013a5ac17c4b68da240

## Goal
Command Center's docs panel shows plans and reviews in a narrow sandboxed iframe on the stage's right edge (`renderer/docs-panel.js:11-16`, `renderer/index.html:137`). Long plans, wide tables and HTML reports are cramped there, and the only ways out today are "Open in VS Code" and "Show in Explorer" (`renderer/docs-panel.js:421-422`). Add an "Open in browser" item to the docs panel's ⋮ menu that opens the shown document, rendered and readable, in the system default browser, so a user can read or print it at full width or keep it open next to the terminal.

## Success criteria
- [x] The docs panel ⋮ menu shows "Open in browser" between "Open in VS Code" and "Show in Explorer".
- [x] Choosing it opens the shown doc in the default browser:
  - a `.md` doc as rendered Markdown;
  - a `.txt` doc as wrapped plain text;
  - an `.html` doc as the file itself, with its relative images and links working.
- [x] Relative images in a `.md` doc resolve in the browser, including for a doc in a folder's `archive/` (base = the folder that actually holds the file).
- [x] File names with spaces, `#`, `%` or non-ASCII characters open correctly, and non-ASCII text in the doc renders correctly (UTF-8 page).
- [x] The item is disabled when no doc is shown (`!d`, same as Open in VS Code).
- [x] These failures each show the existing Docs alert dialog with the reason. Nothing fails silently.
  - Missing file.
  - Not a regular file.
  - File over 2 MB. This applies to `.html` too: same limits as the in-app viewer.
  - Guarded path.
  - Temp write failure.
  - OS open failure.
- [x] `test/docs.test.js` covers the new `browser` action, and `npm test` and `npm run typecheck` pass.
- [x] Verified in the running app (Electron) on these docs:
  - a `.md`;
  - an archived `.md` with a relative image;
  - a file name with spaces;
  - an `.html`.

## Out of scope
- A right-click menu over the document (decided: ⋮ menu only; the sandboxed, script-free iframe never passes right-clicks to the page).
- Changes to other ⋮ menu items, editing documents, a built-in browser pane.
- Exposing the action to the phone/remote rpc (`docs:action` is desktop IPC only, `main.js:1109`).
- Cleaning up temp files (decided by the user: leave them; one file per doc, overwritten on each open, a few KB each).
- Rewriting links between docs. A relative `[x](other.md)` in the browser page points at the raw `.md`, which the OS hands to its `.md` app. This is a documented limitation. In-app these links are inert.
- Following the app's theme setting. The page uses `prefers-color-scheme` and may differ from the app's `data-theme` choice (`renderer/docs-panel.js:82-94`).
- Sandboxing `.html` docs (decided by the user: open as-is, like a double-click in Explorer, so interactive reports keep working).
- The sidebar Prompts/Settings 50% width slice (branch `feat/sidebar-buttons-half-width`).

## Decisions
- **Where:** the existing ⋮ menu in `renderer/docs-panel.js:412-425`. The docs panel has no right-click menu (the only `contextmenu` listener in the renderer is the terminal's, `renderer/agents.js:123`), and the iframe is `sandbox="allow-popups"` with no scripts, so right-clicks inside it never reach the renderer. The user chose ⋮ menu only.
- **How to open (by file type):**
  - `.html`: open the real file itself with `shell.openPath(file)`. This keeps its own styles, scripts and relative assets, so it shows exactly as authored.
  - `.md` / `.txt`: opening these directly would hand them to the OS default app for that extension (an editor or Notepad), not a browser. Instead:
    - Render with the existing `toHtml` (`docs.js:234-238`, marked for `.md`, an escaped `<pre>` for `.txt`) into a standalone UTF-8 page.
    - Write it to `<tempDir>/<stem>-<hash8>.html`. `stem` is truncated to 60 characters to stay clear of MAX_PATH. `hash8` is the first 8 hex characters of the sha1 of the real path, so the same name in different projects never clashes and reopening a doc overwrites its own page.
    - Open that page with `shell.openPath`.
- **Contents of the generated page:**
  - `<meta charset="utf-8">`.
  - `<base href>` = `pathToFileURL(path.dirname(r.file) + path.sep).href`, HTML-escaped. Use the file's own directory, not `r.folderReal`, which is wrong for archived docs (`docs.js:221`). The trailing separator matters: without it relative URLs resolve one folder too high.
  - CSP `default-src 'none'; img-src file: data: https:; style-src 'unsafe-inline'; form-action 'none'`. Rendered Markdown is not sanitized; in-app the iframe CSP is stricter, `default-src 'none'; style-src 'unsafe-inline'; img-src data:` (`renderer/docs-view.mjs:48`). This one blocks scripts, frames and forms but lets local and remote images show.
  - A small readable stylesheet with light/dark via `prefers-color-scheme`. It covers headings, tables, code, `pre.plain` and `img { max-width: 100% }`. It lives in `docs.js` and does not import the renderer's `BASE_CSS`, which would make main depend on renderer code. Put a "keep in step with" comment in both places.
- **Open API: `shell.openPath(file)`, not `openExternal(fileUrl)`.**
  - `openPath` is Electron's API for local files. It takes a native path with no URL parsing and no 2081-character URL limit. It resolves with an error string ('' on success) and never rejects.
  - It is the pattern main already uses (`main.js:1055`).
  - Both APIs use the `.html` file association: Electron has no "default browser" API for local files.
  - The `ops.openInBrowser(file)` wrapper in main turns a non-empty string into a thrown Error, so `docs.js` handles one failure path. (Sources: electronjs.org/docs/latest/api/shell; electronjs.org/docs/latest/tutorial/security, "Do not use shell.openExternal with untrusted content".)
- **IPC:** no new channel.
  - Add `'browser'` to `docs.js` `OS_ACTIONS` (`docs.js:301`) and dispatch it in `docAction` (`docs.js:308`). It then goes through the same `resolveDoc` path guard and the `docs:action` handler with its logging (`main.js:1109-1117`).
  - The OS calls stay injected so `docs.js` stays Electron-free and testable. `ops` gains `openInBrowser(file)` and `tempDir` (main: `path.join(app.getPath('temp'), 'command-center-docs')`).
  - Only main passes paths to the OS, and only resolved real paths.
- **Errors:** the existing pattern. `docAction` returns `{ ok: false, error }`, and `runAction` shows `confirmDialog('Docs', error, { alert: true })` and then reloads the list (`renderer/docs-panel.js:383-386`). The app has no toast component. mkdir, write and open errors are caught and returned as `Could not open <name> in the browser: <reason>`. The dialog may quote an absolute path; the log strips quoted paths (`main.js:1115`).
- **Reading:** split `readDoc`'s stat, isFile check, 2 MB limit and read (`docs.js:241-256`) into a helper that takes the resolved `r`. `readDoc` and the browser action (all types, `.html` stat-only) then share the same limits without resolving twice.

## Steps
- [x] Step 0: Install deps in this worktree. `node_modules` is missing, so `marked` cannot load and `docs.test.js` cannot run. — files: (none; package-lock.json must stay unchanged) — verify: `npm ci && node --test test/docs.test.js`
- [x] Step 1: Add failing tests for `docAction(..., 'browser', ops)` in `test/docs.test.js`.
  - Extend `fakeOps` with `openInBrowser` (records the path; can be made to reject) and `tempDir` (a fresh tmp dir).
  - Cases:
    - **`.html`:** opens the real file path and writes no temp file.
    - **`.md`:**
      - writes `<tempDir>/a-<hash8>.html` and opens that path;
      - the page has `<meta charset="utf-8">`, the rendered `<h1>`, the CSP with `default-src 'none'`, and a `<base href>` that is the doc's folder file URL ending in `/`.
    - **Archived `.md`** (`plans/archive/a.md`): the base ends in `/archive/`.
    - **`.txt`** with `<b>&`: escaped into `<pre class="plain">`.
    - **Non-ASCII and odd names:** a doc `é b #1.md` with non-ASCII content writes the UTF-8 text intact, and its base href is percent-encoded.
    - **Temp file naming:**
      - the same name in two folders gives two different temp files;
      - opening the same doc twice gives the same file, overwritten;
      - a 200-character stem is truncated.
    - **Failures that never reach the OS:**
      - a missing file returns `ok:false` with "no longer exists";
      - a file over 2 MB (`.md` and `.html`) returns the size error;
      - an `openInBrowser` rejection returns `ok:false` with `/in the browser: /`;
      - an unwritable `tempDir` (a path under a regular file) returns `ok:false` with `/in the browser: /`.
    - **Guarded paths:** `../secret.md` never reaches the OS. Add `'browser'` to the loop at the end of the existing guarded-paths test (`test/docs.test.js:~690`).
  — files: test/docs.test.js — verify: `node --test test/docs.test.js` fails only on the new browser cases
- [x] Step 2: Implement in `docs.js`.
  - Extract the read helper from `readDoc`.
  - Add `browserPage(name, dirReal, bodyHtml)`, which builds the standalone page with charset, base, CSP and CSS.
  - Add `tempPageName(name, file)`, which returns the truncated stem plus `-<hash8>.html`.
  - Add `'browser'` to `OS_ACTIONS` and dispatch it in `docAction`:
    - `.html`: stat-check, then `openInBrowser(r.file)`;
    - other types: read, mkdir `tempDir` (recursive), write the page as utf8, then `openInBrowser(pagePath)`;
    - any error: `Could not open <name> in the browser: …`.
  - Update the `ops` doc comment and the file header.
  - Above `browserPage`, add a `// DEFERRED (2026-11-12): …` comment covering the two limits left out of this slice:
    - Relative `.md` links in the page point at the raw `.md`, which the OS hands to its `.md` app. Fixing that means rewriting links and pre-rendering the linked docs.
    - The page follows `prefers-color-scheme`, not the app's `data-theme`. Fixing that means the renderer passing its theme through `docs:action`.
    - Neither was requested. Each is a separate slice if wanted.
  - note: marked 18 emits no heading ids (checked: `# Hello World` → `<h1>Hello World</h1>`), so in-page `#anchor` links are already dead in-app; the `<base>` changing their target is not a regression. (local check)
  — files: docs.js — verify: `node --test test/docs.test.js`
- [x] Step 3: Wire main and renderer.
  - `main.js` `DOC_OS_OPS`:
    - add `openInBrowser: async (file) => { const err = await shell.openPath(file); if (err) throw new Error(err); }`;
    - add `tempDir: path.join(app.getPath('temp'), 'command-center-docs')`.
    - `DOC_OS_OPS` is a module-level const (`main.js:1138`), and `app.getPath('temp')` works before `ready`, but make `tempDir` a getter anyway for safety. Check that `path` is in scope.
  - `renderer/icons.mjs`: add an `external` icon (box with an outward arrow, 24-unit grid, stroked; no text glyphs, per `test/renderer-glyphs.test.mjs`).
  - `renderer/docs-panel.js`:
    - add `{ label: 'Open in browser', icon: ICONS.external, disabled: !d, action: () => runAction('browser') }` after Open in VS Code;
    - add `'browser'` to the "nothing moved" early return (`renderer/docs-panel.js:388`) so success does not touch `remembered`;
    - update the header comment.
  — files: main.js, renderer/icons.mjs, renderer/docs-panel.js — verify: `npm test && npm run typecheck`
- [x] Step 4: Docs.
  - `DESIGN.md:310`: the ⋮ menu list gains "Open in browser" after Open in VS Code.
  - README, if it lists the docs ⋮ actions (`grep -n "Show in Explorer" README.md`).
  — files: DESIGN.md, README.md — verify: `grep -n "Open in browser" DESIGN.md`
- [x] Step 5: Verify in the running app with the `run` skill (`npm start`). Open the docs panel on this worktree, then:
  - ⋮ → Open in browser on `plans/docs-open-in-browser.md` opens a rendered page in the default browser.
  - It also works on `plans/docs-open-in-browser.html` (the file itself opens).
  - It also works on a temp `plans/archive/x y.md` containing `![](pic.png)` with `plans/archive/pic.png` (the image shows).
  - With no doc shown, the item is disabled.
  - With the menu open, delete a test doc from outside the app, then choose Open in browser: the Docs alert names the missing file and the list refreshes.
  - Remove the temp test docs afterwards.
  — files: (none) — verify: `ls "$TEMP/command-center-docs/" | grep docs-open-in-browser-` lists the rendered page

## Risks
- The user's default handler for `.html` may not be a browser (for example an editor), and Electron has no API that targets the default browser for local files → both paths then open in that app. This is the same association a double-click uses. Accept it, note it in the commit message, and do not work around it (a localhost server or spawning the browser exe is out of scope).
- Rendered Markdown in the temp page is not sanitized → the page CSP blocks scripts, frames and forms. `.html` docs open as-is, with scripts and `file://` access, by the user's decision. The page is opened only on the user's explicit click on a doc inside their own project folders, behind `resolveDoc`.
- `openPath` resolving means only that the shell call succeeded. A browser that fails after launch shows nothing in the app → accept it; same as Open in VS Code.
- Rendered copies of private docs stay in `%TEMP%\command-center-docs` (the user chose no cleanup) → overwritten per doc, never shared. Mention it in the README if it documents the docs panel.
- Two copies of the doc CSS (`docs.js` and `renderer/docs-view.mjs`) can drift → cross-reference comments in both.

## Log
<!-- appended by /workflow:work: one entry per completed step -->
- 2026-11-12 Deepened — 4 criteria, 1 steps, 3 risks, 2 notes
- 2026-11-12 Step 0 — done
  verify: `npm ci && node --test test/docs.test.js` → ℹ pass 59, ℹ fail 0 (1 skipped)
- 2026-11-12 Step 1 — done
  red: `node --test test/docs.test.js` → ℹ pass 59, ℹ fail 8 (the 8 new browser tests)
  learning: `.html` path needs no temp file; tests assert `tempDir` stays empty
- 2026-11-12 Step 2 — done
  green: `node --test test/docs.test.js` → ℹ pass 67, ℹ fail 0
  learning: ENOENT is mapped to "no longer exists" only when `e.path === r.file`, so a missing temp folder reports as a browser-open failure
- 2026-11-12 Step 3 — done
  green: `npm test` → ℹ pass 467, ℹ fail 0; `npm run typecheck` → exit 0
  learning: `tempDir` is a getter on DOC_OS_OPS so `app.getPath` runs per call, not at module load
- 2026-11-12 Step 4 — done
  verify: `grep -n "Open in browser" DESIGN.md` → DESIGN.md:310; README.md:35-40 also lists the item and the temp folder
- 2026-11-12 Step 5 — done (app driven via Playwright `_electron`, isolated `--user-data-dir`, a `cmd.exe` stand-in for `claude.exe`)
  - ⋮ menu: `["Archive","Open in VS Code","Open in browser","Show in Explorer","Folders and file types…","Move to Recycle Bin"]`
  - `shell.openPath` called with:
    - `…\Temp\command-center-docs\docs-open-in-browser-1baac5d3.html` (.md)
    - `…\plans\docs-open-in-browser.html` (.html as is)
    - `…\command-center-docs\x y-e0ffe4b2.html` (archived, name with spaces)
  - rendered archived page: `base: file:///C:/projects/…/plans/archive/`, image `naturalWidth: 64`, CSP `default-src 'none'; img-src file: data: https:; …`
  - doc deleted while the menu was open → Docs alert `zz-doomed.md no longer exists`, `openPath` not called
  - no docs → `Open in browser [disabled]`
  - `.html` UserChoice ProgId = `MSEdgeHTM`, so the open lands in the browser
  verify: `ls "$TEMP/command-center-docs/" | grep docs-open-in-browser-` → `docs-open-in-browser-1baac5d3.html`
  learning: Electron `userData` on Windows ignores the APPDATA env; pass `--user-data-dir` to avoid the running instance's single-instance lock
- 2026-11-12 Final: `npm test` → ℹ pass 467, ℹ fail 0, ℹ skipped 1; `npm run typecheck` → exit 0; no linter configured
