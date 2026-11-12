# Sidebar footer: Prompts and Settings side by side, 50/50

Base: 22c27852f8ba7098192e0013a5ac17c4b68da240

## Goal
The board footer holds two buttons, Prompts and Settings (`renderer/index.html:42-45`). Today `.sidebar-footer` is a `display: flex` row with `gap: 4px` and `padding: 12px` (`renderer/style.css:548-552`) and each `.settings-btn` is `inline-flex` sized to its content (`renderer/style.css:554-565`), so the pair hugs the left edge and leaves the rest of the row empty. Make the two buttons share the footer row in two equal columns, each exactly half of it, at every sidebar width the app allows (260–560px, clamped in `renderer/app.js:111`), with labels that truncate cleanly instead of overflowing or wrapping. Icons, labels, click handlers (`renderer/prompts.js`, `renderer/settings.js:172`), hover (`renderer/style.css:567-570`), the global focus ring (`renderer/style.css:120`) and keyboard access stay as they are.

## Success criteria
- [x] Prompts and Settings sit on one row; their rendered widths are equal (±0.5px) and together with the 4px gap fill the footer's content box, at sidebar widths 260, 340 and 560px.
- [x] Labels never wrap or spill outside their button; when space runs out they end in an ellipsis and the icon stays visible.
- [x] Clicking Prompts opens the prompts menu and clicking Settings opens the settings dialog, as before; Tab reaches both and shows the cyan focus ring uncut.
- [x] Light and dark themes both render correctly (the board is theme-invariant per DESIGN.md "The Dark Board Rule"); screenshots taken in both.
- [x] `npm test` passes, including a new static guard test for the footer layout.
- [x] DESIGN.md footer description matches the new layout.

## Out of scope
- Other sidebar elements, new buttons, colour/typography/padding restyling of the buttons.
- Clamping the saved width on load (`renderer/app.js:99-100` restores an unclamped value) — pre-existing, separate.
- The docs viewer "Open in browser" slice (`feat/docs-open-in-browser`).

## Decisions
- "Half the sidebar width" = half of the footer row inside its existing 12px padding, minus the existing 4px gap: each button is `(sidebarW − 24 − 4) / 2`. Keeping padding and gap avoids restyling (out of scope) and keeps the buttons on the board's inset. At the 260px minimum each button is 116px — "Settings" fits; truncation is a guard for zoom/font scaling.
- Use `display: grid; grid-template-columns: repeat(2, minmax(0, 1fr))` on `.sidebar-footer`. Plain `1fr` has an `auto` (min-content) minimum and would let a longer label steal width, breaking the exact 50/50; `minmax(0, 1fr)` forces equal columns.
- Buttons become `display: flex` with `min-width: 0` and `justify-content: center` (icon + label centred in each half); the svg gets `flex-shrink: 0`; the label `<span>` gets `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. `overflow: hidden` goes on the span only, so the button's focus outline is not clipped.
- The renderer has no DOM tests (`test/renderer-contract.test.mjs:5-7`); the regression test is a static CSS/markup guard in the same style as `test/renderer-tokens.test.mjs`. Real layout is verified in the running app via the existing CDP helper (`scripts/e2e-docs/cdp.js`).

## Steps
- [x] Step 1: Add a failing static guard test: footer markup contains exactly `#prompts-btn` then `#settings-btn`, each with an svg and a `<span>` label; `.sidebar-footer` is `display: grid` with `grid-template-columns: repeat(2, minmax(0, 1fr))`; `.settings-btn` has `min-width: 0`; `.settings-btn span` has `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap` — files: test/renderer-sidebar-footer.test.mjs — verify: `node --test test/renderer-sidebar-footer.test.mjs` fails on the CSS assertions (RED)
- [x] Step 2: Implement the 50/50 grid footer and label truncation per Decisions; update the DESIGN.md footer line ("Prompts and Settings as muted icon-and-label buttons, side by side in two equal halves; labels truncate with an ellipsis") — files: renderer/style.css, DESIGN.md — verify: `npm test`
- [x] Step 3: Real-app check via CDP (launch per `scripts/e2e-docs/README.md`): for widths 260/340/560 set `--sidebar-w`, assert equal widths and full-row fill, click each button and assert its dialog opens, screenshot in dark and light (`data-theme` on `<html>`, `renderer/settings.js:65`) — files: (none, screenshots in `%TEMP%\cc-docs-e2e\shots`) — verify: `CDP_PORT=9334 node scripts/e2e-docs/cdp.js eval "[260,340,560].every(w=>{document.documentElement.style.setProperty('--sidebar-w',w+'px');const f=document.querySelector('.sidebar-footer'),[a,b]=f.querySelectorAll('button'),ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect(),cs=getComputedStyle(f),inner=f.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);return Math.abs(ra.width-rb.width)<0.5&&Math.abs(ra.top-rb.top)<0.5&&Math.abs(ra.width+rb.width+parseFloat(cs.columnGap)-inner)<0.5})"` prints `true`

## Risks
- Saved sidebar width below 260px (unclamped restore, `renderer/app.js:100`) → grid + ellipsis still holds the 50/50 split; truncation covers it.

## Log
<!-- appended by /workflow:work: one entry per completed step -->
- 2026-11-12 Step 1 — done
  red: `✖ footer is a two-column grid of exactly equal halves` (actual 'flex', expected 'grid'); `✖ footer buttons can shrink…` (min-width undefined)
  verify: `node --test test/renderer-sidebar-footer.test.mjs` → pass 1, fail 2 (expected RED)
  learning: worktree had no node_modules → 4 unrelated suites failed until `npm ci`
- 2026-11-12 Step 2 — done
  green: `node --test test/renderer-sidebar-footer.test.mjs` → pass 3
  verify: `npm test` → ℹ pass 462, ℹ fail 0
  learning: —
- 2026-11-12 Step 3 — done
  verify: `CDP_PORT=9347 node scripts/e2e-docs/cdp.js eval "[260,340,560].every(...)"` → `true`, exit 0
  measured: buttons 115.67 / 155.67 / 265.67px each at 260 / 340 / 560, both 30px high (one line), labels untruncated; forced 130px → 50.67px each, labels "P…"/"S…" with ellipsis, 14px icons intact
  clicks: #prompts-btn → menu with 7 items ending "Manage prompts…"; #settings-btn → settings overlay shown
  focus: #prompts-btn focused → `solid 2px rgb(91, 192, 214)` outline, drawn uncut in screenshot
  shots: %TEMP%\cc-docs-e2e\shots\sb-dark-340, sb-light-340, sb-light-260, sb-dark-560, sb-dark-130-truncate, sb-prompts-menu, sb-settings-open, sb-focus (.png)
  also: `npm run typecheck` → exit 0
  learning: Prompts opens a menu (prompts.js:52-63), not a dialog — criterion wording corrected
