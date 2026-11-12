---
name: cc-manage
description: Turn the plan in this chat into Command Center worktrees (one per repo slice, under the Worktrees folder) or workspaces, each with a new running session started with a skill you pick. Shows one table and creates nothing until you approve. Works only inside a session launched by Command Center.
argument-hint: "[optional notes, e.g. which skill to start with]"
---

# cc-manage

Turn the plan discussed in this chat into ready Command Center (CC) sessions:
one git worktree per repo slice under `<worktreeRoot>/<repo>/<slug>`, or one
workspace folder under `<workspaceRoot>/<slug>` for work tied to no repo, each
with a new CC session whose first prompt is a starting skill plus a brief.

You talk to CC only through `node "$CC_CLI" <op>`. You run git yourself.
Nothing is created before the user approves the summary table.

Arguments: `$ARGUMENTS` (optional notes from the user; follow them).

## Rules

- Never create, overwrite or delete anything for a row that is skipped or in
  conflict. Never touch an existing branch or folder.
- In shell commands and in JSON, write Windows paths with forward slashes
  (`C:/wt/Repo/feat`): Git Bash, git and CC all accept them, and no
  backslash escaping is needed. Never use MSYS paths (`/c/...`); CC rejects them.
- Quote every path in shell commands.
- Pass arguments to `$CC_CLI` only through a quoted heredoc
  (`<<'CC_ARGS_EOF'`), with the JSON on one line; call `config` with
  `< /dev/null`.
- If the plan is unclear about what goes where, ask before building the table.

## 1. Check the session and read the config

```bash
test -n "$CC_CLI" && test -f "$CC_CLI" && echo ok
node "$CC_CLI" config < /dev/null
```

- If `CC_CLI` is empty, the file is missing, or the CLI exits with code 2:
  stop and say "This only works in a Command Center session: start this chat
  from Command Center and try again." Change nothing.
- If it fails otherwise, show the error and stop.

`config` returns JSON:

- `worktreeRoot`, `workspaceRoot`: the default folders ('' = not set)
- `projects[]`: `{ dir, name, isGit, defaultRef }`, the registered projects.
  `defaultRef` is the branch new work forks from (e.g. `origin/main`), or null.
- `workspaces[]`: `{ dir, name }`
- `agents[]`: `{ id, cwd, dir, branch, status, live, callerSelf }`

Check only the roots this plan needs: `worktreeRoot` if any item uses a git
repo, `workspaceRoot` if any item is tied to no repo. If one is unset, stop
and tell the user to set it in Command Center → Settings → General
(Worktrees folder / Workspaces folder).

## 2. Turn the plan into rows

Read the plan from this conversation. Split it into work items: one item = one
slice of work in one repo, or one piece of work tied to no repo. Two separate
slices in one repo are two rows (two worktrees, two branches, two sessions).

For each item:

1. **Repo.** Match the repo the plan names against `projects[]` by folder name
   (the last part of `dir`, case-insensitive) or `name`.
   - No match → row **skipped: not registered in Command Center** (do not
     register it; tell the user to add the project in CC first).
   - Two registered projects with that folder name → **skipped: ambiguous
     name** (list both dirs).
   - `isGit: false` → a **project-folder** row: the session runs in the
     project's own folder; no worktree, no branch.
   - `isGit: true` but `defaultRef` is null → **skipped: no default branch**
     (no `origin/HEAD`, `origin/main` or `origin/master`).
   - Not tied to any repo → a **workspace** row.
2. **Slug.** From the feature name: lowercase ASCII letters, digits and `-`,
   at most 40 characters, no leading or trailing `-`. Unique among this
   plan's rows for the same repo (and among workspace rows).
3. **Branch and folder.**
   - Worktree row: branch `feat/<slug>`, folder
     `<worktreeRoot>/<repo folder name>/<slug>`.
   - Workspace row: folder `<workspaceRoot>/<slug>`, no branch.
   - Project-folder row: folder = the project `dir`.
4. **Conflicts** (worktree and workspace rows):
   ```bash
   git -C "<dir>" remote get-url origin                  # fails → skipped: no origin remote
   git -C "<dir>" show-ref --verify --quiet "refs/heads/feat/<slug>" && echo branch-exists
   test -e "<folder>" && echo folder-exists
   ```
   An existing branch or folder → **conflict: branch exists** /
   **conflict: folder exists**. Do not pick another name yourself; the user
   can rename the row in step 4.
5. **Starting skill.** Pick the best fit from the skills installed in this
   session (the skill list you were given, plus `ls ~/.claude/skills`), for
   example a planning skill for a slice that still needs design, or an
   implementation skill for a slice with a ready plan. Use the user's choice
   if they named one. Write it as `/<skill-name>` exactly as it is invoked.
6. **Brief.** Write a self-contained brief for the new session, which will not
   see this chat: the goal of this slice, what is in and out of scope, the
   relevant decisions and constraints from the plan, acceptance criteria,
   and which other slices exist (repo and branch) if they depend on each
   other. Plain text, line breaks allowed.
   The first prompt is `/<skill> <brief>` and must stay under 8,000
   characters in total; keep the brief well under that.

## 3. Show the table

Show one table with every row, created or not:

| # | Repo | Branch | Folder | Starting skill | Brief (one line) | Status |
|---|------|--------|--------|----------------|------------------|--------|

Status is `create`, `skipped: <reason>` or `conflict: <reason>`. Under the
table, say plainly that nothing has been created yet, and how many
worktrees, workspaces and sessions approval will create.

If no row has status `create`, stop here.

## 4. Ask for approval

Use AskUserQuestion with one question (header `Create`):
"Create the worktrees and sessions in the table?" with options
`Create all` (recommended), `Change rows` and `Cancel`.

- `Cancel` → stop. Say that nothing was created.
- `Change rows` or a free-text answer → apply the changes (another slug,
  skill or brief, dropping rows), re-check conflicts, show the table again and
  ask again.
- `Create all` → step 5.

## 5. Create, row by row

Work through the approved rows in order. If a step fails, stop that row,
record the error, and go on with the next row. Never retry with another name.

**Worktree row:**

```bash
git -C "<dir>" fetch --prune origin                                   # fails → row: fetch failed
git -C "<dir>" show-ref --verify --quiet "refs/heads/feat/<slug>" && echo branch-exists   # re-check
test -e "<folder>" && echo folder-exists                                                   # re-check
mkdir -p "<worktreeRoot>/<repo folder name>"
git -C "<dir>" worktree add --no-track -b "feat/<slug>" "<folder>" "<defaultRef>"
git -C "<dir>" config "branch.feat/<slug>.ccBase" "$(git -C "<folder>" rev-parse HEAD)"
```

`--no-track` keeps the new branch from tracking `origin/<default>`; the first
`git push -u` sets its real upstream. `ccBase` records the commit the branch
started from, so `/cc-clean-worktrees` can tell a fresh worktree from a merged
one.

**Workspace row:**

```bash
test -e "<folder>" && echo folder-exists   # re-check
mkdir "<folder>"
```

**Project-folder row:** nothing to create.

**Then start the session** (every row). `dir` is the project `dir` exactly as
`config` gave it (for a workspace row: the new folder), `cwd` is the folder,
and `prompt` is the first prompt as a JSON string (escape `"` as `\"`,
`\` as `\\`, and line breaks as `\n`):

```bash
node "$CC_CLI" spawn <<'CC_ARGS_EOF'
{"dir": "<project dir or workspace folder>", "cwd": "<folder>", "prompt": "<first prompt as a JSON string>"}
CC_ARGS_EOF
```

It prints `{ "id", "dir", "cwd", "kind" }`. The session appears in CC's
sidebar under its project or workspace and starts on the prompt; the user's
active terminal does not switch. CC also pre-accepts Claude's "trust this
folder?" prompt for the folder.

If `spawn` fails after the worktree or folder was created, do not delete it:
report the error and the folder, so the user can start a session there by
hand.

## 6. Report

Show the table again with a result per row: `created` (with the session id),
`skipped: <reason>`, `conflict: <reason>` or `failed: <step and error>`.
Then:

- where the sessions are (CC sidebar, under each project or workspace);
- if a new session still shows a "trust this folder?" prompt, accept it once
  (another running Claude session can overwrite CC's trust setting);
- `/cc-clean-worktrees` removes these worktrees again once they are merged.
