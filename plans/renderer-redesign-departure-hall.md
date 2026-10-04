# Renderer redesign: Departure Hall

## Goal
Replace the generic, dated look of the desktop renderer (`renderer/`) with the "Departure Hall" world agreed in brainstorming. The agent list becomes a calm departure board: quiet rows that only speak when something changes, and one yellow band reserved for agents that need you. Every feature stays. Dark and light themes have equal priority.

Sources:
- Direction contract: `.impeccable/surfaces/renderer-index-html.md`
- Product truth: `PRODUCT.md`
- Reference mock: `.impeccable/mocks/decision/departure-v5.png`

## Success criteria
- [ ] Every element ID in `renderer/dom.js` still exists in `renderer/index.html` (contract test).
- [ ] Agents in needs-input appear in a yellow "Needs you" band above the list, oldest first, at most 3, then "+n". They no longer appear as rows in the list. Clicking an entry activates that agent.
- [ ] `--signal` (yellow) is used only by needs-input selectors and `--select` (cyan) only by selection and unseen selectors (token test).
- [ ] The board defaults to 340px and stays resizable. At 1440×900 the terminal is at least as wide as with today's 240px default minus 100px. The pass strip is no taller than 52px.
- [ ] Dark and light themes both pass WCAG AA (4.5:1) for body text and 3:1 for UI glyphs, checked by a token contrast test. In light mode the board stays dark slate.
- [ ] No text-glyph icons (`◐ ＋ + ✦ ⚙ ✕ ▲ ▼ ▸ ▾ ⋮`) remain in renderer markup or JS-built buttons. All icons come from `renderer/icons.mjs`.
- [ ] A state change plays one stepped transition (about 90ms, `steps(2)`), never on render or scroll, and none under `prefers-reduced-motion`.
- [ ] New ANSI palettes for both themes. Foreground on background is at least 7:1, and every ANSI color except black is at least 3:1 on its background.
- [ ] Settings, worktree picker, confirm, prompt, prompts manager, kebab menus and the diff viewer all use the new tokens and components.
- [ ] Impeccable finish review returns `ship`, and `DESIGN.md` plus `.impeccable/design.json` are written from the built world.

## Out of scope
- `mobile/` (the phone app).
- New features, frameworks, a build step, DOM tests.
- Per-agent ahead/behind counts. No IPC exists for them (`renderer/agent-git.mjs:28` fetches only branch and diffstat), so the pass strip shows Project, Agent and Changes.
- Bundled fonts. Bahnschrift, Segoe UI and Cascadia Mono are Windows system fonts. The app is Windows-only and the CSP allows only `'self'`.

## Steps
- [x] Step 1: Add a renderer contract test that reads `renderer/dom.js` and `renderer/index.html` and asserts every `getElementById` ID exists in the HTML, so the restructure cannot drop a wired element — files: test/renderer-contract.test.mjs — verify: `node --test test/renderer-contract.test.mjs`
- [x] Step 2: Test first, then add a pure needs-band model. `bandModel(agents, cap = 3)` returns needs-input agents ordered by `needsSince` (oldest first), with project name, label and block message, plus `more` = the overflow count. Record `a.needsSince` and `a.blockMessage` where needs-input is set, and clear them on leave — files: test/needs-band.test.mjs, renderer/needs-band.mjs, renderer/agent-status.mjs — verify: `node --test test/needs-band.test.mjs`
- [x] Step 3: Test first, then the token system. Add a contrast test that parses the `:root` / `[data-theme]` blocks in `renderer/style.css`, and checks AA pairs for both themes plus that `--signal` and `--select` only appear in allowed selectors. Rewrite the tokens: board slate (fixed in both themes), stage, raised and hairline neutrals, `--signal #F2C230`, `--select #5BC0D6`, status colors, type families (Bahnschrift / Segoe UI / Cascadia Mono), a 4-step type scale, 4px radius, no shadows. Base element styles follow the tokens — files: test/renderer-tokens.test.mjs, renderer/style.css — verify: `node --test test/renderer-tokens.test.mjs`
- [x] Step 4: Test first, then one icon set. A glyph test scans `renderer/index.html` and renderer `*.js` for text-glyph icons. Add `renderer/icons.mjs` with stroke-based inline SVG strings, and replace every glyph button (theme toggle, add, kebab, chevrons, close, search prev/next/close, prompts, settings) — files: test/renderer-glyphs.test.mjs, renderer/icons.mjs, renderer/index.html, renderer/sidebar.js, renderer/stage.js, renderer/modals.js, renderer/prompts.js, renderer/settings.js, renderer/worktree.js, renderer/diff.js — verify: `node --test test/renderer-glyphs.test.mjs test/renderer-contract.test.mjs`
- [x] Step 5: Rebuild the board markup and CSS:
  - Header: wordmark, search toggle that reveals `#sidebar-filter`, collapse-all, theme toggle.
  - Always-visible All / Active / Sleeping segmented control (`#agent-filter`).
  - Empty `#needs-band` slot.
  - PROJECTS / WORKSPACES labels with hover add buttons (`#add-project`, `#add-workspace`).
  - Project headings with hover "+ New agent" and ⋮.
  - Agent rows: signal square and label. A state word only for unseen, error and rate-limited. Needs-input rows are hidden from the list.
  - Collapsed headings show mini signal squares.
  - Dormant rows dimmed.
  - Default `--sidebar-w` 340px.
  — files: renderer/index.html, renderer/sidebar.js, renderer/app.js, renderer/style.css — verify: `npm test && npm run typecheck`
- [x] Step 6: Wire the yellow band. Render it from `bandModel` on `onStatusChanged` and `onAgentsChanged`: agent label, then project and block message, "+n" overflow, and click to activate. Hide it when empty — files: renderer/sidebar.js, renderer/style.css — verify: `npm test && npm run typecheck`
- [x] Step 7: Add the signature motion. `setStatus` updates the row's signal and state word and adds a one-shot `flap` class (`steps(2)`, about 90ms, removed on `animationend`), never during `renderSidebar`. Add a `prefers-reduced-motion` override — files: renderer/agent-status.mjs, renderer/sidebar.js, renderer/style.css — verify: `npm test && npm run typecheck`
- [x] Step 8: Rebuild the stage bar as a pass strip. Labeled segments are Project, Agent (keep `#sb-branch`) and Changes (`+n −n` from the active agent's `diffStat`), then the editor split button, Fetch, Pull, Diff and Find. Max height 52px. Restyle `#term-search` to match — files: renderer/index.html, renderer/stage.js, renderer/agent-git.mjs, renderer/style.css — verify: `npm test && npm run typecheck`
- [x] Step 9: Test first, then terminal palettes. Move the xterm themes out of `renderer/settings.js:15-60` into a pure `renderer/term-palettes.mjs` with new Departure dark and light ANSI palettes. The test checks fg/bg ≥ 7:1 and ANSI ≥ 3:1. `settings.js` imports them — files: test/term-palettes.test.mjs, renderer/term-palettes.mjs, renderer/settings.js — verify: `node --test test/term-palettes.test.mjs && npm run typecheck`
- [x] Step 10: Restyle the overlays and menus in the system: settings (tabs as segmented control, switches, inputs, selects), worktree picker, confirm, prompt, prompts manager, kebab and editor menus — files: renderer/index.html, renderer/style.css, renderer/modals.js, renderer/prompts.js, renderer/worktree.js, renderer/settings.js — verify: `npm test`
- [x] Step 11: Restyle the diff viewer (file list, hunks, add/del colors from the tokens, both themes) — files: renderer/diff.js, renderer/style.css — verify: `npm test`
- [ ] Step 12: Run the finish pass:
  1. Launch the app and capture dark and light screenshots at 1440×900 into `.impeccable/review/` (`desktop.png`, `desktop-light.png`).
  2. Run `impeccable detect --json renderer/` once and fix mechanical findings.
  3. Run the impeccable finish reviewer against the contract and `departure-v5.png`, then apply its fix batch.
  4. Run the documenter to write `DESIGN.md` and `.impeccable/design.json`.
  — files: renderer/index.html, renderer/style.css, renderer/sidebar.js, renderer/stage.js, DESIGN.md, .impeccable/design.json, .impeccable/review/desktop.png, .impeccable/review/desktop-light.png — verify: `npm test && test -f DESIGN.md && test -f .impeccable/design.json`

## Risks
- **No DOM tests, so a restyle can silently break wiring.** The contract test (step 1) guards IDs. Run the app by hand after steps 5, 6, 8 and 10.
- **`renderSidebar` rebuilds rows**, so the flap could replay on every render. The flap is triggered only from `setStatus` on a real change (`renderer/agent-status.mjs:20`).
- **Hiding needs-input rows** could make a filtered-out agent unreachable. The band ignores the text filter and the All / Active / Sleeping filter.
- **Dark board in the light theme** may read as unfinished. Judge it in the step 12 light screenshot, and decide with the user if the reviewer flags it.
- **Band stacking (3, then "+n") is unconfirmed by the user.** It is a single constant in `needs-band.mjs`.

## Log
<!-- appended by /workflow:work: one entry per completed step -->
- 2026-10-04 Step 1 — done
  red: n/a (regression guard; current markup is already complete)
  green: `node --test test/renderer-contract.test.mjs` → ℹ pass 1, ℹ fail 0
  learning: dom.js wires 107 elements by ID
- 2026-10-04 Step 2 — done
  red: `node --test test/needs-band.test.mjs` → ERR_MODULE_NOT_FOUND renderer/needs-band.mjs
  green: → ℹ pass 5, ℹ fail 0
  learning: blockMessage must be set before setStatus, because setStatus notifies listeners synchronously
- 2026-10-04 Step 3 — done
  red: `node --test test/renderer-tokens.test.mjs` → ℹ pass 2, ℹ fail 4 (tokens missing, legacy tokens present)
  green: → ℹ pass 6, ℹ fail 0
  learning: the old --needs-input red doubled as "danger" in 12 places; split into --danger, --del and --st-needs
- 2026-10-04 Step 4 — done
  red: `node --test test/renderer-glyphs.test.mjs` → ℹ fail 1 (glyph icons in index.html, sidebar.js, prompts.js, diff.js, worktree.js)
  green: `node --test test/renderer-glyphs.test.mjs test/renderer-contract.test.mjs` → ℹ pass 2, ℹ fail 0; `npm test` → ℹ pass 243
  learning: modals.js closes menus when e.target lacks .kebab, so SVGs inside buttons need pointer-events:none. Branch/remote glyphs in labels (⎇ ⬇ ↑ ↓) are content, not icons, and stay
- 2026-10-04 Step 5 — done
  red: n/a (markup and CSS; guarded by the contract test)
  green: `npm test` → ℹ pass 243, ℹ fail 0; typecheck exit 0; harness screenshots .impeccable/review/preview-{dark,light}.png show the board in both themes
  deviation: dom.js gained filterToggle and needsBand refs (central ID map; not in the step's files list)
  learning: the installed Command Center hosts this session, so the build is checked in a browser harness (.impeccable/harness/: fake window.api plus seeded agents) instead of a second Electron instance. State words and hiding needs-input rows use :has() on the dot class, so they follow setStatus without a re-render
- 2026-10-04 Step 6 — done
  red: n/a (view wiring over the tested bandModel)
  green: `npm test` → ℹ pass 243; typecheck exit 0. In the harness, 5 needs-input agents give a band of 3 items plus "+2 more waiting", hide 5 list rows, and clicking item 2 activates that agent (stage shows "⎇ main")
  learning: collapsed-heading mini squares refresh on onStatusChanged, so a folded project still shows live state
- 2026-10-04 Step 7 — done
  red: n/a (motion; checked in the harness)
  green: `npm test` → ℹ pass 243; typecheck exit 0. Harness: no flap at render or on busy; flap class plus animation "flap" on error, removed after it ends; reducedMotion=reduce gives animation "none"
  learning: the flap is limited to loud states (unseen, error, rate-limited, needs-input), because busy<->idle flips on every burst of output and would make the board restless
- 2026-10-04 Step 8 — done
  red: n/a (markup and CSS; contract test guards IDs)
  green: `npm test` → ℹ pass 243; typecheck exit 0. Harness light/dark show the pass strip with Project / Agent / Changes (+214 −12) and the actions, at 48px
  deviation: dom.js gained sbProject, sbChanges and sbChangesSeg. agent-git.mjs now calls updateStageBar for the active agent, and its unused fmtDiff is removed
- 2026-10-04 Step 9 — done
  red: `node --test test/term-palettes.test.mjs` → ERR_MODULE_NOT_FOUND renderer/term-palettes.mjs
  green: → # pass 5, # fail 0; `npm test` → ℹ pass 248; typecheck exit 0
  deviation: style.css .term inset now leaves an 18px left and 10px top gutter. Text sat flush against the board edge; offsets, not padding, so FitAddon stays correct
- 2026-10-04 Step 10 — done
  red: n/a (restyle)
  green: `npm test` → ℹ pass 248. Harness captures in both themes (.impeccable/review/ov-*.png): settings, settings-remote, agent menu, worktree picker, prompts menu, prompts manager, confirm
  learning: the harness server needs HTTP/1.1 keep-alive on Windows; one connection per file exhausted sockets (ERR_NO_BUFFER_SPACE) and broke module loads at random
- 2026-10-04 Step 11 — done
  red: n/a (restyle)
  green: `npm test` → ℹ pass 248 (token test covers the new .diff-tab.active cyan); harness ov-{dark,light}-diff.png show the file list, hunks, and add/del in both themes
