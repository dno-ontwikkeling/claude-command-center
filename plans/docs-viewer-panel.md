# Plan and review viewer panel

## Goal
Add a read-only side panel on the stage, right of the terminal, that shows the active agent's `plans/` and `reviews/` documents (`.md` and `.html`) so you can read what an agent wrote without leaving the window. The panel never opens on its own. A header dropdown picks the document. The shown file re-renders when it changes on disk.

## Design decisions (from brainstorming)
- Placement: right of the terminal, toggled from the stage bar. Never auto-opens.
- Scope: only `<cwd>/plans` and `<cwd>/reviews`, `.md` and `.html`.
- Render: markdown is converted to HTML in the main process with `marked`. Markdown and HTML both go into one `<iframe sandbox srcdoc>` with no `allow-scripts`. The iframe is the sanitizer, so no DOMPurify. The app CSP (`script-src 'self'`, `renderer/index.html:5`) also blocks scripts inside the frame.
- Picker: dropdown in the panel header, grouped Plans / Reviews, newest first, with type-to-filter and keyboard navigation. Opens the newest doc by default, then remembers the last choice per agent folder (in memory).
- Live reload: the renderer polls `docs:list` once a second while the panel is open and re-reads the shown file when its mtime or size changes. Poll, not `fs.watch`: it also covers folders that do not exist yet, and it only runs while the panel is open. This is the same "poll floor" idea as `renderer/app.js:63`.
- Read-only. No editing.

## Success criteria
- [x] A toggle button in the stage bar opens and closes a panel right of the terminal. The terminal refits on toggle and on panel resize. The panel never opens by itself.
- [ ] The picker lists `.md` and `.html` from `<cwd>/plans` and `<cwd>/reviews`, grouped, newest first, with filter and keyboard navigation. Missing folders show an empty state.
- [x] Markdown renders with headings, lists, tables, code fences and links. HTML renders static.
- [ ] Scripts in HTML never run. Clicking an `http(s)` link opens the default browser and never navigates the app or the frame.
- [ ] Editing the shown file re-renders within about 2 s and keeps the scroll position. A new file appears in the picker without reopening the panel.
- [x] Switching agent switches the panel to that agent's folders, the remembered doc or else the newest.
- [ ] `docs:list` and `docs:read` reject unknown `cwd`, paths outside `plans/` and `reviews/`, `..`, symlink escapes, other extensions and files over 2 MB.
- [x] Light and dark both look right per `DESIGN.md` and pass the existing token tests. The panel width is draggable and remembered.
- [x] `npm test` and `npm run typecheck` pass.

## Out of scope
- Editing, other folders, scripts in HTML.
- The phone app (new remote protocol messages).
- Auto-open, a badge on agent rows for new files.
- Search inside a document, relative links between docs, tabs for several open docs.
- `fs.watch` watchers.

## Steps
- [x] Step 1: Add the `marked` dependency and ship the new module — files: package.json, package-lock.json — verify: `node -e "const {marked}=require('marked'); if(!marked.parse('# x').includes('<h1')) process.exit(1)"`
- [x] Step 2: Write failing tests for the main-side docs module: `listDocs(cwd)` returns `{rel, kind, mtimeMs, size}` for `.md` and `.html` in `plans/` and `reviews/`, newest first, and `[]` for missing folders; `readDoc(cwd, rel)` returns `{ok, html}` with markdown rendered and HTML passed through; it rejects `..`, absolute paths, other extensions, a symlink pointing outside the folder (skip that case when symlinks are not permitted), and files over 2 MB — files: test/docs.test.js — verify: `node --test test/docs.test.js` fails with "Cannot find module '../docs'"
- [x] Step 3: Implement `docs.js` (Electron-free CJS, same style as `gitinfo.js`) and add it to `build.files` — files: docs.js, package.json — verify: `node --test test/docs.test.js`
- [x] Step 4: Write failing tests for the pure renderer helpers in `renderer/docs-view.mjs`: `groupDocs(list)` gives Plans / Reviews groups newest first; `filterDocs(list, query)` matches case-insensitively on the file name; `docsSignature(list)` changes when a file's path, mtime or size changes; `buildFrame(html, tokens)` returns a full document with a CSP meta tag (`default-src 'none'; style-src 'unsafe-inline'; img-src data:`), the theme tokens as CSS variables, and the body untouched — files: test/docs-view.test.mjs — verify: `node --test test/docs-view.test.mjs` fails with a missing module error
- [x] Step 5: Implement `renderer/docs-view.mjs` — files: renderer/docs-view.mjs — verify: `node --test test/docs-view.test.mjs`
- [x] Step 6: Wire the IPC: `docs:list` and `docs:read` handlers gated by `isKnownDir` (`main.js:204`); a `will-frame-navigate` handler that, for sub-frame navigations to `http(s)` URLs, calls `preventDefault()` and `shell.openExternal`, and blocks every other sub-frame navigation except the initial srcdoc load (same pattern as `will-navigate` at `main.js:1512`); `listDocs(cwd)` and `readDoc(cwd, rel)` in `preload.js`; the types in `types/ipc.d.ts` — files: main.js, preload.js, types/ipc.d.ts — verify: `npm run typecheck && npm test`
- [x] Step 7: Add the markup, the dom refs and the styles: a `#sb-docs` button in the stage bar after Find; a `#docs-panel` section and a `#docs-resizer` on the stage; `.show-docs` on `#stage` narrows `#terminals` with `right: var(--docs-w)`; panel header with picker button, popup list, filter input and close button; icons from `renderer/icons.mjs`; tokens only, no new colors, follow `DESIGN.md` — files: renderer/index.html, renderer/dom.js, renderer/style.css, renderer/icons.mjs — verify: `node --test test/renderer-contract.test.mjs test/renderer-tokens.test.mjs test/renderer-glyphs.test.mjs`
- [x] Step 8: Implement `renderer/docs-panel.js` and import it from `renderer/app.js`: toggle from `#sb-docs` and the close button (Esc closes the picker first, then the panel); picker with grouped list, filter and arrow/Enter navigation; a one second poll while open that updates the picker and re-reads the shown doc when `docsSignature` changes, restoring scroll; a re-render on theme change; per-folder remembered choice; reset on agent switch (hook into `activate` / `updateStageBar`); drag resize with the width saved in `localStorage` and every terminal refit afterwards, as in `renderer/app.js:103-120`; panel hidden and polling stopped when no agent is active or the dashboard shows — files: renderer/docs-panel.js, renderer/app.js, renderer/stage.js — verify: `npm test && npm run typecheck`
- [x] Step 9: Run the app and check the feature end to end with the `run` skill: open a project that has `plans/` and `reviews/`, toggle the panel, pick a markdown and an HTML doc, edit the file and see it update, click an `https` link, switch agents, switch theme, drag the panel width; attach screenshots of both themes to the log — files: (none) — verify: `npm start` launches without console errors and the checks above pass
- [x] Step 10: Document the feature in `README.md` (Features list) and `PRODUCT.md` (Operating Context: the new panel and button), and note the panel in `DESIGN.md` Components — files: README.md, PRODUCT.md, DESIGN.md — verify: `node --test test/renderer-tokens.test.mjs` and `grep -n "Docs" README.md PRODUCT.md DESIGN.md`

## Risks
- Frame navigation: a link click inside a sandboxed frame without `allow-popups` may do nothing, or navigate the frame. → `will-frame-navigate` handler in Step 6 prevents and routes to the browser; confirm in Step 9. If Electron does not emit the event for srcdoc frames, fall back to `<base target="_blank">` plus `setWindowOpenHandler` routing `http(s)` to `shell.openExternal`.
- `marked` ships ESM and CJS entry points. → Step 1 verifies `require('marked')` works under the installed Electron's Node, and the packaged build includes `node_modules/**` already (`package.json` build.files).
- Agent-written HTML with remote images or fonts shows broken. → Accepted. The frame CSP allows only `data:` images. Out of scope to relax.
- Large or fast-changing files cause churn at one poll per second. → 2 MB cap, and the signature check means a re-read happens only on a real change.
- Terminal flicker or a wrong pty size while toggling or dragging. → The existing `ResizeObserver` on `.term` (`renderer/agents.js:201`) refits on any size change. Step 9 checks it.
- The `will-frame-navigate` handler must not break the initial srcdoc load. → Allow `about:srcdoc` and `about:blank`.

## Open questions
- None.

## Log
<!-- appended by /workflow:work: one entry per completed step -->
- 2026-10-04 Step 1 — done
  red: skipped, dependency-only step
  green: npm install marked → package.json lists "marked": "^18.0.14"
  verify: node -e "const {marked}=require('marked'); ..." → exit 0
  learning: marked 18 loads via require() in CJS and Electron's Node; build.files already has node_modules/**. npm audit shows 4 high issues, none in marked.
- 2026-10-04 Step 2 — done
  red: node --test test/docs.test.js → Error: Cannot find module '../docs'
  green: n/a (tests-only step)
  verify: node --test test/docs.test.js → exit 1 (expected)
  learning: tests expect readDoc to return {ok:false,error} and never throw; exactly 2 MB accepted, 2 MB + 1 rejected; backslash '..' and absolute paths rejected.
- 2026-10-04 Step 3 — done
  red: Error: Cannot find module '../docs' (from Step 2)
  green: node --test test/docs.test.js → pass 14, fail 0, skipped 1
  verify: node --test test/docs.test.js → exit 0
  learning: the symlink-escape test skips on this Windows box (EPERM without elevation), so the realpath containment check has only been code-reviewed, not run against a real symlink. Run the suite once from an elevated shell or Developer Mode to exercise it.
- 2026-10-04 Step 4 — done
  red: ERR_MODULE_NOT_FOUND: Cannot find module '.../renderer/docs-view.mjs'
  green: n/a (tests-only step)
  verify: node --test test/docs-view.test.mjs → exit 1 (expected)
  learning: buildFrame tests include a style-injection case: a token value containing '</style>' must not appear raw in the output.
- 2026-10-04 Step 5 — done
  red: ERR_MODULE_NOT_FOUND (from Step 4)
  green: node --test test/docs-view.test.mjs → pass 15, fail 0
  verify: node --test test/docs-view.test.mjs → exit 0
  learning: buildFrame keeps only token names matching /^--[a-z0-9-]+$/ and drops values containing < > { } ; or a newline; base styles use only var(--token), no hard-coded colors.
- 2026-10-04 Step 6 — done
  red: skipped, IPC wiring is not unit-testable here
  green: npm run typecheck → exit 0; npm test → pass 277, fail 0, skipped 1
  verify: npm run typecheck && npm test → exit 0
  learning: isKnownDir already accepts agent worktree dirs via knownAgentDirs, so gating docs:list / docs:read on it is enough. will-frame-navigate only fires correctly for real sub-frame clicks; confirm in Step 9.
- 2026-10-04 Step 7 — done
  red: renderer-contract "every ID in renderer/dom.js exists in renderer/index.html" failed with the new dom.js refs and no markup
  green: node --test renderer-contract/tokens/glyphs → pass 8, fail 0
  verify: node --test test/renderer-contract.test.mjs test/renderer-tokens.test.mjs test/renderer-glyphs.test.mjs → exit 0
  learning: the --select reservation test only accepts selectors with active/focus/selected/resizing, so the current doc row uses li[aria-selected='true']. CSS was appended at the end of style.css (line 2330+); the user's uncommitted edits were left alone. Layout is not checked by any test, so Step 9 must look at it.
- 2026-10-04 Step 8 — done
  red: skipped, DOM wiring and the repo has no DOM tests
  green: npm test → pass 277, fail 0, skipped 1; npm run typecheck → exit 0; docs-panel.js read through for undefined refs
  verify: npm test && npm run typecheck → exit 0
  learning: view.js toggles show-dash with no callback, so docs-panel.js watches the stage class with a MutationObserver. Esc only closes the panel while focus is inside it. Known gap: .sb-btn.on has no style, so the Docs button shows no pressed state (check in Step 9). User's uncommitted edits in app.js were kept.
- 2026-10-04 Step 9 — done
  red: link click in the docs frame navigated the frame and it went blank (ERR_BLOCKED_BY_CSP in the app log; the parent CSP default-src 'self' blocks https frame navigation before will-frame-navigate can act). New test in test/docs-view.test.mjs failed first: "base target must sit in <head>"
  green: after the fix the frame keeps its document after a link click, no CSP errors in the app log; npm test → pass 278, fail 0, skipped 1 (baseline 248); npm run typecheck → exit 0
  verify: real app driven over CDP in an isolated profile (--user-data-dir in the scratchpad, fixture repo with plans/ and reviews/): closed by default; Docs opens beside the terminal and the terminal refits (1562 → 952 px, restored on close); newest doc opens by default; picker groups, filter and Esc order work; markdown (table, code, links) and HTML render; <script> in HTML did not run; live edit appeared in 460 ms; a new file showed in the picker within 2 s; light theme re-renders the frame; drag width 460 → 610 px and saved to localStorage; switching agents A↔B swaps the folder; the dashboard closes the panel. Screenshots: C:/Users/olivi/AppData/Local/Temp/claude/C--Projects-Applications-claude-command-center/4cf92897-8806-4304-904a-bb46cd942689/scratchpad/shots (04, 06, 07, 10, 11)
  learning: will-frame-navigate was replaced. Links now rely on <base target="_blank"> in the frame, sandbox="allow-popups" on the iframe, and setWindowOpenHandler routing http(s) to shell.openExternal (main.js). Not observed: the system browser actually opening, since the test could not watch the OS. Also added picker CSS (age right-aligned, group labels) and a pressed state for .sb-btn.on. In-page #anchors in a doc do nothing (they open a blocked popup).
- 2026-10-04 Step 10 — done
  red: skipped, documentation-only step
  green: node --test test/renderer-tokens.test.mjs → pass 6, fail 0
  verify: node --test test/renderer-tokens.test.mjs && grep -n "Docs" README.md PRODUCT.md DESIGN.md → exit 0
  learning: DESIGN.md has no stage-bar entry, so the Docs panel entry sits before Needs Band. One claim (rows ruled by hairlines) was wrong and was corrected after review.

## Criteria not yet met or not proven
- Picker empty state (missing plans/ and reviews/): not run in the real app.
- Links: the frame survives a click and the app log shows no CSP error, but the system browser opening was not observed.
- IPC guards: unit tests cover `..`, absolute paths, extensions and size. The symlink-escape case is skipped on this machine (EPERM). Rejection of an unknown cwd is in the code (isKnownDir) but has no test.
- Re-render keeps scroll position: not met. The sandbox has no allow-same-origin, so scroll cannot be read, and a re-render resets it.
