---
name: Command Center
description: A departure board for many Claude Code agents. Quiet rows, one yellow band for "you are needed", and the terminal edge to edge.
colors:
  board: "#0e1317"
  board-raised: "#161e25"
  board-hover: "#131a20"
  board-line: "#1f2a33"
  board-fg: "#e6ebee"
  board-muted: "#8c99a3"
  signal: "#f2c230"
  on-signal: "#14181b"
  on-signal-muted: "#4a3f14"
  select: "#5bc0d6"
  select-light: "#12748a"
  st-quiet: "#5c6975"
  st-busy: "#3d7bff"
  st-unseen: "#b59cf5"
  st-error: "#f25555"
  st-rate: "#f0883e"
  bg: "#0a0e11"
  panel: "#0e1317"
  elevated: "#151c22"
  border: "#1f2a33"
  border-strong: "#5c6975"
  fg: "#e6ebee"
  muted: "#8c99a3"
  danger: "#ef6f5e"
  add: "#7fd49b"
  del: "#ef7f6e"
  scrim: "#05080a"
  bg-light: "#f4f5f2"
  panel-light: "#ffffff"
  elevated-light: "#eef0ec"
  border-light: "#dadfd8"
  border-strong-light: "#848d95"
  fg-light: "#14181b"
  muted-light: "#59636b"
  danger-light: "#b93a2b"
  add-light: "#1d7a45"
  term-bg-light: "#fafaf7"
typography:
  display:
    fontFamily: "Bahnschrift, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "0.16em"
  headline:
    fontFamily: "Bahnschrift, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "0.02em"
  figure:
    fontFamily: "Bahnschrift, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    fontFeature: "tnum"
  title:
    fontFamily: "Bahnschrift, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "0.01em"
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  body-sm:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "Bahnschrift, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.18em"
  state-word:
    fontFamily: "Bahnschrift, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.08em"
  mono:
    fontFamily: "Cascadia Mono, Cascadia Code, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  square: "1px"
  inner: "3px"
  base: "4px"
spacing:
  unit: "8px"
  half: "4px"
  gap: "12px"
  modal: "16px"
  board-inset: "22px"
components:
  needs-band:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.base}"
    padding: "10px 6px 6px"
  agent-row:
    backgroundColor: "{colors.board}"
    textColor: "{colors.board-fg}"
    typography: "{typography.body}"
    height: "48px"
    padding: "0 12px 0 22px"
  agent-row-hover:
    backgroundColor: "{colors.board-hover}"
  agent-row-active:
    backgroundColor: "{colors.board-raised}"
  signal-square:
    backgroundColor: "{colors.st-quiet}"
    rounded: "{rounded.square}"
    size: "7px"
  segmented-option:
    textColor: "{colors.board-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.inner}"
    padding: "5px 0"
  segmented-option-on:
    backgroundColor: "{colors.board-raised}"
    textColor: "{colors.board-fg}"
  pass-button:
    textColor: "{colors.fg}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.base}"
    height: "30px"
    padding: "0 10px"
  pass-button-hover:
    backgroundColor: "{colors.elevated}"
  button-primary:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.panel}"
    rounded: "{rounded.base}"
    padding: "8px 12px"
  button-primary-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.panel}"
  button-ghost:
    textColor: "{colors.fg}"
    rounded: "{rounded.base}"
    padding: "8px 12px"
  button-ghost-hover:
    backgroundColor: "{colors.elevated}"
  input-field:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.fg}"
    rounded: "{rounded.base}"
    padding: "7px 9px"
  menu:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    rounded: "{rounded.base}"
    padding: "4px"
  modal:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    rounded: "{rounded.base}"
    padding: "16px"
    width: "320px"
---

# Design System: Command Center

## Overview

**Creative North Star: "The Departure Hall"**

The agent list is an airport flight-information board: a matte slate field of rows, one per agent, each announcing its project, its branch and its state, with one yellow band reserved for "you are needed". Everything the board announces is set in Bahnschrift, a condensed DIN, in tracked capitals and tabular figures; running text and controls stay in Segoe UI, and the terminal keeps Cascadia Mono. The board is the same dark slate in both themes. In the light theme only the hall around it brightens: the stage, the terminal and the dialogs go light, so the board reads as a dark sign hanging in a bright room.

The system is flat and hairline-ruled. Depth comes from tonal steps (field, hover, raised) and 1px rules, never from drop shadows or card boxes. Colour is spent almost entirely on state: two hues are reserved and guarded by `test/renderer-tokens.test.mjs`, and every other surface is slate, porcelain or ink. The density suits long, full-screen sessions: 48px two-line rows, 13px body text, 52px of chrome above a terminal that runs edge to edge. The board lists agents only; projects and workspaces are managed on the dashboard, a page that takes the stage.

Motion is two devices. When an agent lands in a loud state, its square and state word step once, a two-frame flap with no easing. The All / Active / Sleeping pill slides to the chosen option over 200ms on a strong ease-in-out. Everything else holds still.

**Key Characteristics:**
- A theme-invariant slate board beside a theme-switching stage.
- Signal yellow means "needs you" and nothing else. Cyan means selection and focus and nothing else.
- Each row is a 7px signal square, the project name over the branch, and a state word for every state. No times.
- Bahnschrift tracked capitals for labels, figures and names; Segoe UI for prose and buttons; Cascadia Mono for code.
- Flat: tonal layers and hairlines, 4px corners, no elevation shadows.
- Two motions: the 90ms two-step flap, and the 200ms slide of the filter pill.

## Colors

A matte slate and porcelain palette with two reserved signal hues and a small set of state colours.

### Primary
- **Signal Yellow** (#f2c230): the "Needs you" band, the needs-input signal square, and the needs entry in the Set status menu. Text on it is **Departure Ink** (#14181b), with **Burnt Umber Ink** (#4a3f14) for the band heading, the meta line and "+n".

### Secondary
- **Gate Cyan** (#5bc0d6 dark, #12748a on light surfaces): selection and focus only. Used for the focus ring, focused input borders, the checked switch and checkbox accent, the active diff tab underline, prompt-manager drop targets, the resizer while dragging, and the search toggle when it is on.

### Tertiary
- **Fault Coral** (#ef6f5e dark, #b93a2b light): danger buttons, destructive menu items and error text in dialogs.
- **Finished Lavender** (#b59cf5): the finished (unseen) state word and square.
- **Hold Orange** (#f0883e): the rate-limited state word and square.
- **Fault Red** (#f25555): the error state word and square. Red, not orange, so a crashed agent never reads as one waiting out a rate limit.
- **Ledger Green** (#7fd49b dark, #1d7a45 light) and **Ledger Red** (#ef7f6e dark, #b93a2b light): added and removed counts in the pass strip, diff lines and worktree badges. These are git colours, not state colours.

### Neutral
- **Board Slate** (#0e1317): the board field in both themes, and the dark-theme panel.
- **Board Raised** (#161e25): the selected row, the active segmented option, the board search field and icon-button hover.
- **Board Hover** (#131a20): row and heading hover on the board, one step above the field.
- **Board Line** (#1f2a33): board hairlines (sidebar edge, segmented outline, search outline, the rule above the "below" marker). The dark-theme `border` uses the same value.
- **Porcelain** (#e6ebee): board text and dark-theme stage text.
- **Transit Blue** (#3d7bff): the busy signal square and the WORKING state word. A true blue, kept well clear of Gate Cyan so "working" never reads as "finished".
- **Board Mist** (#8c99a3): muted board text, the branch line and the calm state words (IDLE, SLEEPING, ENDED), section labels, inactive segmented options, icon buttons. The dark-theme `muted` uses the same value.
- **Quiet Slate** (#5c6975): the idle, done, dormant and dead squares (dormant and dead as 1px outlines), and the dark-theme strong border on menus and dialogs.
- **Hall Black** (#0a0e11): the dark stage and terminal background.
- **Elevated Slate** (#151c22): dark-theme hover fills, inputs, active tabs, sticky heads.
- **Hall Paper** (#f4f5f2), **White Panel** (#ffffff), **Elevated Paper** (#eef0ec), **Paper Line** (#dadfd8), **Paper Strong Line** (#848d95), **Ink** (#14181b), **Ink Muted** (#59636b), **Terminal Paper** (#fafaf7): the light-theme stage, panels, hovers, rules, text and terminal.
- **Scrim** (#05080a dark, Ink light): the dialog backdrop, mixed to 62% opacity.

### Named Rules
**The Reserved Yellow Rule.** Signal yellow appears only where an agent needs input: the band, the needs square, the needs status option. A selector that uses it must name needs or band, and the token test fails the build otherwise.

**The Reserved Cyan Rule.** Cyan marks selection, focus and checked, and nothing else. It never decorates, never marks a heading, and never stands in for a brand colour.

**The Dark Board Rule.** `board`, `board-raised` and `board-fg` are identical in both themes. The light theme changes the stage, terminal and dialogs only.

**The Terminal Amber Rule.** Terminal ANSI yellow is a muted amber (#e0b252 dark, #8a6400 light), so terminal output never imitates the "needs you" signal.

## Typography

**Display Font:** Bahnschrift (with Segoe UI fallback)
**Body Font:** Segoe UI Variable Text (with Segoe UI, system-ui)
**Label/Mono Font:** Cascadia Mono (with Cascadia Code, Consolas) for the terminal, diff lines, file paths and search options

**Character:** Bahnschrift sounds like a station board: condensed, engineered, made for figures and tracked capitals. Segoe UI keeps prose and buttons native to Windows and readable over long sessions. All three are system fonts, so nothing is fetched and the CSP stays `'self'`.

### Hierarchy
- **Display** (Bahnschrift 600, 14px, 0.16em, uppercase): the "COMMAND CENTER" wordmark only.
- **Headline** (Bahnschrift 600, 15px, 0.02em): dialog titles, and the agent label in the needs band (no tracking).
- **Figure** (Bahnschrift 400, 15px, tabular numerals): pass-strip values such as project, agent, "2 / 0" and "+214 −12".
- **Title** (Bahnschrift 600, 15px, 0.01em): the project name on each board row and each dashboard row. A sleeping row sets it in Board Mist.
- **Body** (Segoe UI 400, 13px): menus, dialog text. The branch line under a row title is 12px in Board Mist. The confirm message uses line-height 1.5.
- **Body Small** (Segoe UI 400, 12px): buttons in the pass strip, hints, the needs-band meta line, footer buttons. Segmented options and settings tabs use Bahnschrift at this size with 0.04 to 0.06em tracking.
- **Label** (Bahnschrift 400, 11px, 0.16 to 0.18em, uppercase): section labels (PROJECTS, WORKSPACES), pass-strip keys (PROJECT, AGENT, AHEAD / BEHIND, CHANGES), and the band heading at 600 weight.
- **State Word** (Bahnschrift 400, 11px, 0.08em, uppercase): WORKING, IDLE, NEEDS YOU, FINISHED, ERROR, RATE LIMITED, ENDED, SLEEPING at the end of a board row.
- **Mono** (Cascadia Mono 400, 12px): terminal default (user-adjustable), diff lines at line-height 1.5, file paths.

### Named Rules
**The Board Voice Rule.** Anything the board or the pass strip announces (names, labels, figures, state words, tabs, dialog titles) is Bahnschrift. Anything you read as a sentence or press as a button is Segoe UI. Code is Cascadia Mono.

**The Tracked Caps Rule.** Uppercase text is always Bahnschrift at 11px and always tracked: 0.16 to 0.18em for labels, 0.08em for state words. Uppercase is for field names on the board, not for decoration.

## Layout

The window is a two-column grid: the board on the left (340px by default, resizable through a 6px splitter on its edge) and the stage filling the rest. The stage opens with the 52px pass strip, a row of segments split by hairlines (Project, Agent, Ahead / Behind, Changes), then the actions pushed right (Visual Studio split button, Fetch, Pull, Diff, Find). Under the strip the terminal runs edge to edge on its own background, with a 10px top, 18px left and 14px bottom gutter set as offsets so the terminal fit stays exact.

The spacing unit is 8px, with half (4px) and one-and-a-half (12px) steps inside dialogs. On the board, the wordmark, section labels and agent rows share a 22px left inset; the segmented control, search field, needs band and "below" marker sit 14px from the board edges. Board rows are 48px high, ruled by Board Line hairlines. Section labels get 18px above them.

The board never scrolls its chrome: the header, filter, needs band and footer stay put, and only the agent lists scroll. When a loud row (needs, error, finished) scrolls out of view, a "N error below" marker sits on the list's bottom edge and jumps to it. Scrollbars are hidden everywhere.

At narrow stage widths (a container query at 860px on the pass strip) the action buttons collapse to icons and keep their titles. The project segment is the first to give up width.

### Dashboard
The dashboard replaces the terminal on the stage while it is open, and fills the stage whenever no agent is active. It opens with a 52px bar in the pass-strip style (Projects, Workspaces, Running, Sleeping, Needs you as Label keys over Figure values, then Add project and New workspace pushed right). Below, Projects and Workspaces each get a Label heading, a one-line hint and a hairline-ruled list, capped at 960px wide with a 32px side gutter. A row is the name in Title Bahnschrift over its path in 12px Cascadia Mono, then one signal square per agent (each opens or resumes that agent) with a "2 running · 1 sleeping" count, then Open worktree (projects) or New agent (workspaces) and a ⋮ menu with Open in Explorer and Forget. Rows reorder by drag; the grip shows on hover.

## Elevation & Depth

The system is flat. Depth is tonal: on the board, field, then hover, then raised; on the stage, background, then panel, then elevated. Overlays (menus, dialogs, terminal search) are lifted by a 1px strong border and, for dialogs, a scrim at 62% opacity, never by a drop shadow.

### Shadow Vocabulary
- **Hollow square** (`box-shadow: inset 0 0 0 1px var(--st-dormant)`): draws the dormant and dead signal squares as outlines. This is a stroke, not elevation.
- **Tab underline** (`box-shadow: inset 0 -2px 0 var(--select)`): the active diff tab's cyan rule.

### Named Rules
**The Hairline Not Shadow Rule.** Nothing casts a shadow. Separate things with a 1px rule or a tonal step; lift overlays with the strong border and the scrim. Inset shadows are allowed only as strokes (hollow squares, underlines).

## Shapes

Corners are a near-square 4px everywhere: buttons, inputs, menus, dialogs, the needs band, segmented controls. Elements nested inside a 4px container (segmented options, needs-band items) use 3px. The signal square is a 7px square with a 1px radius. Icons are stroked SVG on a 24-unit grid at 1.8 stroke width with round caps, sized 14px by default and drawn in `currentColor`. The settings switch track is the only fully rounded shape.

## Components

### Buttons
Plain and native; the label carries them, not the fill.
- **Shape:** 4px corners.
- **Primary:** an ink-on-porcelain inversion (Porcelain fill with Board Slate text in dark, Ink fill with white text in light), 600 weight, 8px 12px padding. Hover drops opacity to 0.88. The danger variant fills with Fault Coral.
- **Ghost:** transparent with a 1px border, same padding; hover fills with the elevated tone. A danger ghost turns its text coral.
- **Pass-strip button:** transparent, 30px high, 12px Segoe UI with a 14px icon and a 7px gap; hover fills with the elevated tone; disabled at 40% opacity. The Visual Studio button is a split button sharing one outline with its caret.
- **Icon button:** 26px square, transparent, muted icon; hover raises the fill and brightens the icon. On the board, an icon button that is toggled on turns cyan.
- **Focus:** a 2px cyan outline offset by 1px on every focusable element. Inside the yellow band, the outline turns Departure Ink and insets by 2px.

### Segmented control
The All / Active / Sleeping filter and the settings tabs. A 1px outline with 2 to 3px padding; options are Bahnschrift 12px, lightly tracked, muted at rest. The active option fills with the raised tone (board) or the elevated tone (dialogs) and turns full-strength text. No cyan. On the board's All / Active / Sleeping filter the fill is a single pill that slides between options over 200ms with `cubic-bezier(0.77, 0, 0.175, 1)` (`--ease-in-out`), a transition so a second click retargets mid-slide, off under reduced motion and not run on first paint.

### Inputs / Fields
- **Style:** 1px border, 4px corners, the elevated fill inside dialogs (panel fill in the worktree picker), 7px 9px padding (9px 12px at 14px in the picker search).
- **Focus:** the native outline is replaced by a cyan border.
- **Board search:** 30px high on the raised tone with a Board Line outline; turns cyan when focused.
- **Switch:** a 34 by 20px track on the elevated tone with a muted knob; when checked, the track fills cyan and the knob takes the panel colour. Transitions run 150ms.

### Menus and Dialogs
- **Menu:** panel fill, 1px strong border, 4px corners, 4px padding, 150px minimum width; items are 7px 10px with a 14px icon, hover on the elevated tone, destructive items in coral.
- **Dialog:** panel fill, 1px strong border, 4px corners, 16px padding, 12px gap between blocks, a 320px base width (360px for settings, 480px wide, 560px for the worktree picker). The title is Headline Bahnschrift; actions sit right-aligned.
- **Lists inside dialogs** (prompts, worktrees) are rows ruled by bottom hairlines with an elevated hover, not cards.

### Navigation (the board)
- **Header:** the wordmark, then search, theme and dashboard icon buttons. The dashboard icon turns cyan while the dashboard is open.
- **Sections:** PROJECTS and WORKSPACES Label headings, each with a + that opens a menu of that section's folders (picking one starts an agent there) and a Manage link to the dashboard.
- **Agent row:** 48px, a 7px signal square, a 14px gap, the project name in Title Bahnschrift over the custom name or branch in 12px Board Mist, then the state word. Rows are ruled by a Board Line hairline. Hover fills with the hover tone; the selected row fills with the raised tone. On hover the state word hides to make room for the ⋮ menu. A sleeping row mutes its title.
- **Footer:** Prompts and Settings as muted icon-and-label buttons.

### Docs panel
A read-only column on the right of the stage, opened by the Docs button in the stage bar and never on its own. It uses the Departure Hall stage tokens, not the dark board: `--panel` fill, a 1px `--border` hairline on its left edge, and a draggable edge that sets the width.
- **Header:** a dropdown button on the `--elevated` hover tone showing the current document, with a type-to-filter field inside the menu.
- **Menu:** groups Plans and Reviews, labelled in `--display` Label type in `--muted`; each row shows the file name with its age on the right, and the selected row carries a `--select` bar and nothing else.
- **Body:** the document in a sandboxed frame with scripts off.

### Needs Band (signature)
The only yellow in the app. A Signal Yellow block, 4px corners, under the filter. The heading "NEEDS YOU" is Label Bahnschrift at 600 in Burnt Umber Ink. Each waiting agent is a full-width button: the agent label in Headline Bahnschrift, then "project · what it asks" in 12px Segoe UI. Agents stack oldest first, split by a 15% ink hairline, up to three, then "+n". An agent needing input keeps its list row, with its yellow signal square, while it also waits in the band, so the project and workspace lists always show every agent. Answering the prompt in the terminal (Enter, Esc, a menu digit or y/n) takes it out of the band at once.

### Signal square and flap (signature)
Nine states map to seven fills: busy in Transit Blue; idle and done in Quiet Slate; dormant and dead as Quiet Slate outlines; needs in Signal Yellow; unseen in Finished Lavender; error in Fault Red; rate limited in Hold Orange. The state word takes the same colour, except the calm words (idle, ended, sleeping), which use Board Mist. When a row lands in a loud state, the square and the state word run the flap: `scaleY(0.15)` and 40% opacity to rest over 90ms in `steps(2, end)`, once. It is turned off under reduced motion. Busy and idle changes never flap.

### Pass strip
A 52px panel bar with a hairline bottom edge. Each segment stacks a Label key over a Figure value, padded 18px, divided by hairlines. Changes show "+n" in Ledger Green and "−n" in Ledger Red.

## Do's and Don'ts

### Do:
- **Do** keep Signal Yellow (#f2c230) on needs-input only, and cyan on selection, focus and checked only. `test/renderer-tokens.test.mjs` enforces both.
- **Do** keep the board tokens identical across themes; theme only the stage, terminal and dialogs.
- **Do** set board and pass-strip labels, names and figures in Bahnschrift, with tabular numerals for counts.
- **Do** separate surfaces with 1px hairlines and tonal steps (field, hover, raised).
- **Do** use 4px corners, and 3px for an element nested inside a 4px container.
- **Do** keep board rows to a square, the project name over the branch, and a state word.
- **Do** pass the existing contrast floor: 4.5:1 for text and 3:1 for squares and strong borders, in both themes.
- **Do** keep terminal ANSI yellow a muted amber.

### Don't:
- **Don't** use drop shadows for elevation; lift overlays with the strong border and the scrim.
- **Don't** put times, diff columns, column heads, language badges or tree lines on board rows.
- **Don't** put project or workspace management on the board; it belongs on the dashboard.
- **Don't** colour a heading, an icon or a button with yellow or cyan to make it stand out.
- **Don't** let an agent that needs input also appear as a list row; it lives in the band. The active agent is the one exception.
- **Don't** animate state changes with eased transitions; the flap is two hard frames, once. The filter pill's slide is the one eased movement.
- **Don't** fetch web fonts or icon fonts; the fonts are Windows system fonts and icons are inline stroked SVG.
