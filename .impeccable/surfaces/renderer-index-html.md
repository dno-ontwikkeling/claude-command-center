---
version: 1
slug: "renderer-index-html"
primary_target: "renderer/index.html"
related_targets: ["renderer/style.css"]
---

# Surface: desktop renderer (renderer/index.html)

Scope: the whole Electron renderer (sidebar, stage bar, terminal, terminal search, five overlays, diff viewer). Mode: Operate.
Job: triage many Claude Code agents at a glance, then jump into one agent's terminal. Full-screen, long sessions.
Constraints: keep every feature and every DOM ID the JS wires. Dark and light themes have equal priority. CSP allows only `'self'`, so fonts and icons are bundled locally. Code-led build (no image generation). The terminal must not lose space to the new chrome.
Critique reference: .impeccable/mocks/decision/departure-v5.png (the user-approved iteration of the decision comp, dark). The earlier departure*.png files are superseded.

## Direction contract

THESIS: The agent list is a calm departure board: quiet rows that only speak when something changes, and one yellow band reserved for "you are needed". It refuses the category default of a tree sidebar with colored dots and grey cards.

OWN-WORLD: Matte slate board (#0E1317 field, #18212A raised) with porcelain text (#E6EBEE). Signal yellow (#F2C230) is used only for needs-input. Cyan (#5BC0D6) is used only for the selection and the "unseen" (finished) word. Bahnschrift (a condensed DIN) for board text, tracked-caps labels and figures. Segoe UI for body text, Cascadia Mono for the terminal. Hairline rules, 4px radii, no shadows and no card boxes. In the light theme the board stays a dark slate field (a dark board in a bright hall), while the stage, terminal and modals go light.

STORY: You glance at the board, see the yellow band naming the agent waiting on you, click it, answer in its terminal, and the band empties.

FIRST VIEWPORT: Left, a calm 340px board:
- Header: the wordmark in tracked caps, a search (filter) icon, and a + icon to add a project or workspace.
- An All / Active / Sleeping segmented control, always visible.
- The yellow "Needs you" band: agent label large, then project and what it asks. Several agents stack oldest first, up to 3, then "+n".
- PROJECTS and WORKSPACES section labels. Each project heading is its name only. Hovering a heading reveals "+ New agent" (opens the worktree picker) and a ⋮ menu.
- Agent rows indented under their project: a 7px signal square and the branch or custom label. A state word appears only for finished, error and rate limited.
- An agent needing input leaves its row and lives only in the band.
- A collapsed project shows its name plus one tiny signal square per agent.
- No times, no diff column, no column heads, no language badges, no tree lines.
- Footer: Prompts and Settings.

Right: a 52px pass strip with labeled segments (Project, Agent, Ahead / Behind, Changes as +n −n), then Visual Studio, Fetch, Pull, Diff and Find, then the terminal edge to edge.

SIGNATURE: When an agent's state changes, its signal and state word step once (a two-frame flap, about 90ms, no easing). An "unseen" (finished) row holds its cyan word until you open it. A needs-input agent moves into the yellow band.

FORM: Departure Hall (airport flight-information boards). Candidate 3 of the grounded list. Seed key e819f587.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved
- Light-theme stage and terminal ANSI palette: to be derived in the build.
- Band stacking (up to 3, then "+n") is an assumption the user has not confirmed.
