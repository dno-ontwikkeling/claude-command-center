# cc-manage: ask which workflow command starts each session

Base: 22c27852f8ba7098192e0013a5ac17c4b68da240

## Goal
`/cc-manage` today picks the starting skill of every new session itself (step 2.5). The user wants to choose: cc-manage asks with an AskUserQuestion option menu which workflow command starts each new session — `/workflow:brainstorm`, `/workflow:plan` or `/workflow:auto` — with free-text Other for any other skill. Without the workflow plugin it falls back to today's auto-pick and says so.

## Success criteria
- [x] `skills/cc-manage/SKILL.md` describes the menu with exactly the three options `/workflow:brainstorm`, `/workflow:plan`, `/workflow:auto` and the free-text Other fallback.
- [x] Step 4 first asks a multiSelect `Create` question with one option per session (split over several questions above 4 rows); unticked rows are `skipped: not selected`.
- [x] Then one `Start #<n>` question per selected session (at most 4 per call), with a one-sentence goal in the question and a `preview` of the first prompt per option.
- [x] The table's `Starting skill` column shows the chosen command, or `ask` before the choice.
- [x] An `Other` answer on `Create` can change a row's starting command.
- [x] Without the workflow plugin, the skill picks the starting skill itself (old behaviour) and says so under the table.
- [x] The first prompt is `/<chosen command> <brief>` and stays under 8,000 characters.
- [x] `test/skills-content.test.js` asserts the above; `npm test` passes.

## Decisions
- User redesign (2026-11-12): `Create` is a multiSelect of the sessions, then a separate round of per-session `Start` questions with context (supersedes the first design: Create/Change rows/Cancel plus a shared Start question above 3 rows).
- Plugin detection by the session's skill list (`workflow:brainstorm` and `workflow:plan`; `workflow:auto` is user-invocable only and never listed). Rejected: probing `~/.claude/plugins` paths — layout is plugin-manager internal.
- A command the user already named in `$ARGUMENTS` for a row is used without asking for that row.

## Assumptions
- `(Recommended)` suffix on an option label is stripped from the chosen command.
- A free-text Other answer is used as `/<name>` (leading `/` added when missing); not validated against installed skills beyond what the old path did.
- README and the frontmatter description get a wording touch-up ("a workflow command you pick"); hooks/skillsync needs no change (content hash just changes).

## Steps
- [x] Step 1: Add cc-manage content tests (RED): the three workflow commands, AskUserQuestion menu, `Other`, the 3-row/shared-question rule, `ask` placeholder, plugin-missing fallback, `Change rows` covering the command, `/<command> <brief>` under 8,000 — files: test/skills-content.test.js — verify: `node --test test/skills-content.test.js` fails on the new tests only
- [x] Step 2: Rewrite step 2.5, step 3 note and step 4 of SKILL.md to the menu; update frontmatter description/argument-hint — files: skills/cc-manage/SKILL.md — verify: `node --test test/skills-content.test.js` passes
- [x] Step 3: README `/cc-manage` bullet wording — files: README.md — verify: `npm test` passes

## Log
- 2026-11-12 Planned (auto, fresh start)
- 2026-11-12 Deepened — verdict go: after `Change rows`, only rows whose command is still `ask` are asked again; a row whose brief grows near the cap keeps the 8,000 check after the command is chosen
- 2026-11-12 Step 1 — done: 5 new tests fail against the old SKILL.md (10 pass, 5 fail)
- 2026-11-12 Step 2 — done: node --test test/skills-content.test.js → 15 pass, 0 fail
- 2026-11-12 Step 3 — done: npm test (NODE_PATH → main checkout node_modules; worktree has none) → 464 pass, 0 fail, 1 skipped
- 2026-11-12 Reviewed — round 1, 0 open: fixed high — plugin check required `workflow:auto` in the skill list, but it is user-invocable only and never listed → always fell back; now checks brainstorm + plan, regression test added
- 2026-11-12 Step 2 — done (rework): multiSelect Create + per-session Start with preview; npm test → 465 pass, 0 fail, 1 skipped
