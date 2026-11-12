# Acceptance: Steer Command Center from Claude Code

Manual checks on the built app for the success criteria in
`plans/claude-code-steering.md` that unit tests can't prove. Tick each item
only after seeing it work; record failures in the plan's `## Log`, then fix
them or park them before ticking.

## Setup

- Build and install: `npm run dist`, then run the NSIS installer from `dist/`.
- In Settings → General set **Worktrees folder** (e.g. `C:\wt`) and
  **Workspaces folder** (e.g. `C:\ws`).
- Registered in CC: two git repos with an `origin` (call them X and Y), one
  registered non-git project N. One more git repo U that is **not**
  registered. In X, create a local branch `feat/taken` beforehand.
- Keep `%APPDATA%\Command Center\logs\main.log` open for the log checks.

## Settings and pickers

- [ ] Settings → General shows **Worktrees folder** and **Workspaces folder** with Choose… and Clear; after an app restart both values are still there.
- [ ] Choosing a drive root, the home folder, the other root (or a folder inside it), a folder inside a registered project, or a folder whose name contains `&` shows an inline message naming the failed rule (and the character), and the stored value is unchanged.
- [ ] Worktree picker → "Create branch" opens its folder dialog at `C:\wt\X` (created if missing); New workspace opens at `C:\ws`. With both roots cleared, both dialogs behave as before.

## /cc-manage

- [ ] In a CC-launched session, `/cc-manage` on a plan with: one slice in X, two slices in Y, one item tied to no repo, one item for N, one for the unregistered repo U, and one whose branch would be `feat/taken` in X. One table appears before anything is created: U is "skipped: not registered", the `feat/taken` row is "conflict: branch exists", the rest are "create".
- [ ] Rejecting the table (Cancel) creates nothing: no new folders under `C:\wt` or `C:\ws`, no new branches, no new sessions.
- [ ] After approval: `C:\wt\X\<slug>`, `C:\wt\Y\<slug-1>` and `C:\wt\Y\<slug-2>` exist as worktrees (`git worktree list`) on new `feat/<slug>` branches with no upstream (`git -C <wt> rev-parse --abbrev-ref @{u}` fails), forked from `origin/<default>` as fetched just before.
- [ ] Each new worktree has a new session in the sidebar under its project; the active terminal on the desktop did not switch.
- [ ] Each session's first prompt reached `claude.exe` intact (line breaks, quotes, non-ASCII text) and ran as the chosen skill.
- [ ] The no-repo item got `C:\ws\<slug>`, registered as a workspace in the sidebar, with a session; N's session runs in N's own folder.
- [ ] No session showed a "trust this folder?" prompt, including the brand-new `C:\ws\<slug>` (check `~/.claude.json` has `hasTrustDialogAccepted: true` for it).
- [ ] An item whose repo has two registered projects with the same folder name is "skipped: ambiguous name"; with the network off (fetch fails), the row reports "fetch failed" and nothing is created for it.
- [ ] Running `/cc-manage` in a Claude session opened in a plain terminal (not from CC) stops with the "only works in a Command Center session" message and changes nothing.

## /command guards and log

- [ ] `main.log` has one `op=… → …` info line per `/command` call from the runs above, with the caller id, op, folder and outcome.
- [ ] From a CC session: `CC_SECRET=wrong node "$CC_CLI" config < /dev/null` exits 1 with HTTP 403, and `CC_AGENT_ID=nope node "$CC_CLI" config < /dev/null` exits 1 with HTTP 404; both leave a warn line in `main.log`.
- [ ] `spawn` with `dir` spelled `c:/…` (lowercase drive, forward slashes, trailing `/`) puts the session under the right project row; with `/c/…` it is refused with the MSYS message.
- [ ] `forget` on the calling session's own folder, on X's main folder, and on a folder outside both roots is refused, and no session stops.
- [ ] A `forget` with several sessions in one worktree (one live, one sleeping) that takes over 5 seconds returns its result to the CLI (no connection reset).
- [ ] `node "$CC_CLI" config` returns within a second in Claude Code's Bash tool, with no stdin redirect.

## /cc-clean-worktrees

- [ ] Prepare under `C:\wt`: one merged worktree (its branch merged into `origin/main` on the remote, local `main` left stale), one idle (last commit older than the threshold: pass `1` as the argument if needed), one fresh from `/cc-manage` with no commits, one orphaned folder (delete its `.git` file), one worktree of the unregistered repo U, one dirty worktree, and enough candidates for more than 4. Restart CC once so at least one candidate has only a sleeping session from the earlier run.
- [ ] The table lists every folder with a verdict: merged / idle / orphaned / keep (new) for the fresh one / keep for U's; dirty and unpushed are flagged; the calling session's own worktree is not listed.
- [ ] With more than 4 candidates, "Pick by number" can select any of them.
- [ ] Nothing is removed before confirming. After confirming (branches: delete if merged): each chosen folder's live and sleeping sessions are gone from the sidebar (including the one from the earlier run), the worktree is gone from `git worktree list` and from disk, the merged branch is deleted, and an unmerged (idle) branch is kept and reported.
- [ ] The dirty worktree asks its own force confirmation; answering Keep leaves it on disk with its sessions sleeping; answering Remove anyway removes it.
- [ ] The orphaned folder is only deleted after its own confirmation.

## Install, update, uninstall

- [ ] First start with `~/.claude/skills/cc-manage` and `cc-clean-worktrees` missing: CC offers to install them; after Install both have a `SKILL.md` and a `.command-center.json`.
- [ ] Edit one installed `SKILL.md`, then install an app build whose bundled skills differ: the unedited one is updated, the edited one is left alone (both noted in `main.log`).
- [ ] An NSIS update (install a newer build over the old one) keeps the status hooks in `~/.claude/settings.json` and the skills in `~/.claude/skills`, and CC does not ask to install the hooks again.
- [ ] A real uninstall removes the CC-owned skills and the status hooks, and leaves an unmarked or edited skill and extra files in `~/.claude/skills` alone.
