# Spec: Steer Command Center from Claude Code

## Problem
The user plans features in a Claude Code chat and then carries the plan over to Command Center (CC) by hand. For each involved repo they create a worktree, pick a parent folder in a dialog with no default, launch a session and paste a starting prompt. With several repos, or several worktrees of one repo, that is slow and error-prone, and the worktrees end up in inconsistent places. Cleanup is just as manual: they have to spot which worktrees are merged or abandoned, forget each session in CC, remove the worktree and delete the branch, one by one. Leftover worktrees and sleeping sessions pile up.

## Approach
**B. Skills run git, CC exposes only `config` / `spawn` / `forget`.** Effort: M. Shipped as one delivery.

The user chose B because it keeps the change to CC small. The trade-off: the skill prose holds the stale rules and the worktree path convention, and the model applies them on every run, so no unit test covers them. The one exception is removing a worktree that has a CC session: `forget` reuses CC's hardened `worktree:remove` (see Decisions).

### CC side
- **Default roots.** Settings → General gets two folder settings: **Worktrees folder** (`<wt-root>`) and **Workspaces folder** (`<ws-root>`). They are stored in main, following the remote-config pattern (`getRemoteConfig`/`setRemoteConfig`, `renderer/settings.js:268`); the Settings UI reads and writes them over IPC.
- **Pickers start there.** Manual worktree creation opens its parent-folder dialog at `<wt-root>/<repo>` (`main.js:756` has no `defaultPath` today). The new-workspace picker opens at `<ws-root>` (`main.js:680`). If a root is unset, the picker behaves as it does today.
- **Command endpoint.** The hook server gets `POST /command`. It uses the same per-agent `x-cc-secret` auth and the same `127.0.0.1` binding as `/event` (`hookserver.js:68`), so only sessions CC launched can call it. Commands:
  - `config` → `{ worktreeRoot, workspaceRoot, projects, workspaces, agents: [{ id, cwd, dir, branch, live, callerSelf }] }`.
  - `spawn { dir, cwd, prompt }` → starts a CC session in the background, so the active terminal doesn't switch. It reuses `rendererCommand('spawn')` (`main.js:1364`). Allowed targets: a worktree of a registered project, checked like `validateRemoteSpawn` (`main.js:1346`), or a folder under `<ws-root>`, which is registered as a workspace if it isn't one yet. `prompt` becomes Claude's positional first prompt; today `spawnAgent` only passes `--resume` and `--dangerously-skip-permissions` (`main.js:355`). `cc.js` rejects prompts over about 8,000 characters.
  - `forget { cwd, removeWorktree, deleteBranch }` → stops and untracks every live and sleeping CC session whose cwd is `cwd`, through `forgetAgent` (`renderer/agents.js:307`). It returns once the processes have exited, so the cwd lock is released on Windows. With `removeWorktree`, it then removes the worktree through `worktree:remove` (`main.js:799`), which retries a locked folder and runs `git worktree prune`. With `deleteBranch`, it runs `git branch -d`; an unmerged branch is kept and reported. `forget` refuses the calling agent's own id and its own cwd.
  - Every `/command` call is logged at info level to `main.log`: caller agent id, op, target cwd. (added)
- **Bundled CLI** `hooks/cc.js`, unpacked from the asar like `report.js`. It reads `CC_PORT`, `CC_AGENT_ID` and `CC_SECRET`, calls `/command` and prints JSON. CC injects `CC_CLI=<path>` at spawn, so skills call `node "$CC_CLI" <cmd>`.
- **Bundled skills** `skills/cc-manage/SKILL.md` and `skills/cc-clean-worktrees/SKILL.md`. On startup CC offers to install them into `~/.claude/skills/` with a consent dialog, as it does for the hooks (`main.js:268`). It updates them when the bundled version changes, but only files that carry CC's marker.
- **Uninstall.** The uninstaller removes the CC-marked skills from `~/.claude/skills/`, as it already removes the status hooks (`hooks/uninstall-hooks.js:32`, `build/uninstaller.nsh:18`). (added)
- **Docs.** The README's security model section (`README.md:138`) describes what `/command` allows and its guards.

### `/cc-manage` (skill)
1. `cc config`. If `CC_CLI` is missing, stop with "Run this from a Command Center session". If a root is unset, stop and point to Settings.
2. From the plan in context, work out the involved repos, a feature slug, one branch per worktree (several worktrees of one repo get distinct feature names), and the starting skill and brief for each session.
   - The skill picks the starting skill at run time from the skills installed in that session (for example a brainstorm, plan or work skill), based on how mature the plan is for that slice. It is not hardcoded.
   - Repos that aren't registered CC projects are listed as skipped, with the reason. Nothing is created for them.
   - A non-git project gets a workspace at `<ws-root>/<name>` instead of a worktree.
3. Show one summary table (repo, branch, path, starting skill, one-line brief) → AskUserQuestion: approve or edit.
4. For each row:
   - Worktree: `git -C <repo> fetch --prune`, then `git -C <repo> worktree add -b <branch> <wt-root>/<repo>/<feature> origin/<default>`, where `<default>` is the repo's default branch.
   - Workspace: `mkdir` the folder.
   - Then `cc spawn --dir <repo> --cwd <path> --prompt "/<skill> <brief>"`. The brief travels as prompt text only, kept to a short paragraph; no file is written.
5. Report what was created, with the paths, and anything that failed.

### `/cc-clean-worktrees` (skill)
1. `cc config` (same gates as above). Optional argument: N days for "idle" (default 14).
2. Run `git fetch --prune` in each repo that has folders under `<wt-root>`. Walk `<wt-root>/<repo>/<feature>` and classify each folder:
   - **merged**: branch merged into `origin/<default>` (`git branch --merged origin/<default>`).
   - **idle**: last commit older than N days.
   - **orphaned**: the folder isn't a registered worktree of any repo.
   - **keep**: everything else.
   Flag dirty (uncommitted changes) and unpushed folders. Exclude the caller's own worktree and every main tree.
3. Show the candidates and their CC sessions → AskUserQuestion (multi-select) for which to remove, plus whether to delete local branches.
4. For each confirmed folder:
   - Has CC sessions: `cc forget --cwd <path> --remove-worktree [--delete-branch]`.
   - No CC sessions: `git worktree remove`, then `git branch -d` if chosen. An unmerged branch is kept and reported.
   - A dirty worktree needs a separate, explicit force confirmation.
   - An orphaned folder is deleted only after its own confirmation, followed by `git worktree prune` in its repo when that repo is known.
5. Report what was removed, kept or failed.

## Value
Value: The single user turns a plan written in a Claude Code chat into ready, running CC sessions with one confirmation, and every worktree lands under one root. Merged or abandoned worktrees, with their sessions, are cleared in one confirmed pass instead of one by one through Forget.
Measure: none agreed. It's a personal tool, judged by feel. The `/command` audit log can supply usage counts later if wanted.

## Success criteria
- Settings → General shows **Worktrees folder** and **Workspaces folder**, each with a folder picker. Both values survive an app restart.
- "Create branch" in the worktree picker opens its folder dialog at `<wt-root>/<repo>`. The new-workspace picker opens at `<ws-root>`. With a root unset, both behave as today.
- In a CC-launched session, `/cc-manage` with a plan that touches registered repos X and Y shows one table before creating anything. After approval, `<wt-root>/X/<feature>` and `<wt-root>/Y/<feature>` exist as worktrees on new branches forked from `origin/<default>`, fetched just before.
- Each new worktree shows a new session in the CC sidebar under its project. Its first prompt is the chosen skill plus the brief, including line breaks and quotes exactly as written. The desktop's active terminal does not switch.
- A plan with two slices of one repo creates two worktrees with distinct folders and branches, and two sessions.
- A non-git project gets `<ws-root>/<name>`, registered as a CC workspace, with a session.
- An involved repo that isn't registered in CC appears in the table as skipped; nothing is created for it.
- Rejecting the summary table creates nothing.
- Running either skill outside a CC-launched session stops with a clear message and changes nothing.
- `/command` returns 403 for a wrong secret and 404 for an unknown agent. `spawn` returns an error for a target that is neither a worktree of a registered project nor a folder under `<ws-root>`, and for a prompt over the length cap.
- `forget` returns an error when it targets the calling agent's own id or cwd.
- Each `/command` call leaves one info line in `main.log` with the caller agent id, op and target cwd. (added)
- `/cc-clean-worktrees` lists every folder under `<wt-root>/<repo>/` with a verdict (merged / idle / orphaned / keep), with dirty and unpushed folders flagged. "merged" is judged against `origin/<default>` after a fetch. The calling session's own worktree is never listed.
- Nothing is removed before confirmation. For each confirmed folder:
  - its live and sleeping CC sessions disappear from the sidebar, including sleeping sessions from an earlier app run;
  - the worktree is gone from `git worktree list` and from disk;
  - the local branch is deleted only if chosen, and an unmerged branch is kept and reported.
- A dirty worktree is never removed without its own explicit force confirmation.
- On first start with the skills missing, CC offers to install them into `~/.claude/skills/`. After an app update that changes them, CC-marked copies are updated and user-edited copies (no marker) are left alone.
- Uninstalling CC removes the CC-marked skills from `~/.claude/skills/` and leaves unmarked ones alone. (added)

## Out of scope
- Sessions not launched by CC (VS Code, plain terminal): the skills refuse to run.
- One session spanning several repos, or a workspace that contains worktrees.
- Detecting squash merges or deleted upstreams; deleting remote branches; creating PRs.
- Brief files on disk: the brief is prompt text only.
- Auto-registering unregistered repos as CC projects.
- Phone UI for manage or clean.
- Scheduled or automatic cleanup without confirmation.
- A CC-side confirmation dialog for `spawn`/`forget`: confirmation stays in the skills.
- "Idle after N days" as a CC setting: it's a skill argument.

## Open questions
- Removing the worktree of a session left sleeping from an earlier app run: `worktree:remove` requires `isKnownDir(wtPath)` (`main.js:800`), which only knows folders spawned during this app run (`main.js:352`). It likely fails with "Unknown directory.", which would also affect today's desktop Forget. The planning step should check this, and if confirmed, validate the path as a registered worktree of `dir` instead.
- Prompt passing through node-pty on Windows: plan step 1 is a spike that spawns `claude.exe` with a multi-line, quoted prompt. If it fails, the fallback is to write the prompt into the terminal after the session's first idle event.

## Decisions
- cut Non-git workspace creation by `/cc-manage` (`<ws-root>/<name>`, `spawn` allowed under `<ws-root>`, Workspaces folder setting) — rejected: the user keeps workspaces as specced.
- addition Uninstaller removes the CC-marked skills — accepted: otherwise dead skills stay in every session after uninstall.
- addition Audit log of `/command` calls — accepted: first agent-to-agent control path, so a trace is wanted.
- question Base ref and "merged" check — answered: `origin/<default>` after `git fetch --prune`, for both.
- question Prompt argv on Windows — answered: spike as plan step 1, 8k cap; pty-write fallback only if the spike fails.
- question Two slices (fan-out first, cleanup second) — rejected: one delivery.
- question Model-side confirmation only — accepted with guards: `forget` refuses the caller's own id and cwd, and the README documents `/command`.
- question `forget` reuses `worktree:remove` — accepted: it keeps the locked-folder retry and prune. The skill uses bare git only for worktrees without CC sessions and for orphan folders.
- question Where the roots persist — answered: main side, like the remote config.
- question Where N days lives — answered: skill argument, default 14.
- question Value measure — answered: none; personal tool, judged by feel.

## Log
- 2026-11-12 Brainstormed — approach B (skills run git, CC exposes config/spawn/forget), effort M
- 2026-11-12 Kept CC `spawn` over the skill launching `claude --bg --session-id` and registering the session with CC. A background session has no CC pty, so it would get no status until opened (`hookserver.js:63`). Opening it goes through `claude stop` + `--resume` (`main.js:446`), which interrupts its turn. And the background child would inherit the caller's `CC_*` env.
- 2026-11-12 Deepened — verdict go, 0 cut, 2 added, 7 answered
