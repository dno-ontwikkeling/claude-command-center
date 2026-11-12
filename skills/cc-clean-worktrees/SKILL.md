---
name: cc-clean-worktrees
description: Find merged, idle and orphaned worktrees under Command Center's Worktrees folder and, after you confirm, remove their Command Center sessions, the worktrees and optionally their merged branches. Nothing is removed before you confirm. Works only inside a session launched by Command Center.
argument-hint: "[idle days, default 14]"
---

# cc-clean-worktrees

List every folder under `<worktreeRoot>/<repo>/`, give each a verdict, and
after the user confirms, remove the chosen ones: their Command Center (CC)
sessions (live and sleeping), the worktree, and, if chosen, the local branch
when it is merged.

You talk to CC only through `node "$CC_CLI" <op>`. You run git yourself.
Nothing is removed before confirmation.

Arguments: `$ARGUMENTS`. A whole number is the idle threshold in days
(default 14).

## Rules

- Never remove anything before the user has confirmed it in step 5.
- Never remove a dirty worktree (uncommitted or untracked changes) without
  its own explicit force confirmation, naming the folder and its changes.
- Never touch the folder this session runs in, or a folder that contains it.
- Never touch a project's main folder, or anything outside `worktreeRoot`.
- Delete a branch only after `git merge-base --is-ancestor <branch> <defaultRef>`
  succeeds, then with `git branch -D`. Never use `git branch -d`: on these
  `--no-track` branches it compares against the main checkout's HEAD, which
  may be a stale local `main`.
- In shell commands and in JSON, write Windows paths with forward slashes
  (`C:/wt/Repo/feat`). Never use MSYS paths (`/c/...`). Quote every path.
- Pass arguments to `$CC_CLI` only through a quoted heredoc
  (`<<'CC_ARGS_EOF'`), with the JSON on one line; call `config` with
  `< /dev/null`.
- Compare paths case-insensitively and with `/` and `\` treated as the same.

## 1. Check the session and read the config

```bash
test -n "$CC_CLI" && test -f "$CC_CLI" && echo ok
node "$CC_CLI" config < /dev/null
```

- If `CC_CLI` is empty, the file is missing, or the CLI exits with code 2:
  stop and say "This only works in a Command Center session: start this chat
  from Command Center and try again." Change nothing.
- If `worktreeRoot` is empty: stop and tell the user to set the Worktrees
  folder in Command Center → Settings → General.

`config` returns `worktreeRoot`, `projects[]` (`{ dir, name, isGit,
defaultRef }`) and `agents[]` (`{ id, cwd, dir, branch, status, live,
callerSelf }`). The agent with `callerSelf: true` is this session; its `cwd`
is this session's folder.

## 2. Inventory

List the candidate folders, two levels below the root:

```bash
ls -d "<worktreeRoot>"/*/*/ 2>/dev/null
```

Drop this session's own folder and any folder that contains it, and any
registered project's main folder. For every other folder, find its repo:

```bash
test -e "<folder>/.git" || echo no-git
test -d "<folder>/.git" && echo full-clone
head -1 "<folder>/.git"                       # "gitdir: <path>" for a linked worktree
git -C "<folder>" rev-parse --path-format=absolute --git-common-dir
```

- No `.git` → **orphaned** (leftover folder, no git metadata).
- `.git` is a file whose `gitdir:` target does not exist → **orphaned**.
- `.git` is a folder → **keep (not a worktree)**.
- Otherwise the repo's main folder is the parent of the git common dir
  (`<repo>/.git` → `<repo>`). Match it against `projects[].dir`.
  Not registered → **keep (repo not registered in CC)**; never orphaned.

For each registered repo that has folders here, once:

```bash
git -C "<dir>" fetch --prune origin
```

If the fetch fails or `defaultRef` is null, every folder of that repo is
**keep (fetch failed)** / **keep (no default branch)**: merged can't be judged.

## 3. Classify each worktree of a registered repo

```bash
git -C "<folder>" symbolic-ref --short -q HEAD            # branch (empty = detached)
git -C "<folder>" rev-parse HEAD                          # tip
git -C "<dir>" config --get "branch.<branch>.ccBase"      # base recorded by /cc-manage (may be empty)
git -C "<folder>" merge-base --is-ancestor HEAD "<defaultRef>" && echo in-default
git -C "<dir>" reflog show --format=%H "refs/heads/<branch>" | wc -l   # 1 = no commits since the branch was created
git -C "<folder>" log -1 --no-merges --format=%ct "<defaultRef>..HEAD" # last own commit (unix time)
git -C "<dir>" log -g --format=%ct "refs/heads/<branch>" | tail -1     # branch creation time (fallback)
git -C "<folder>" status --porcelain                      # non-empty = dirty
git -C "<folder>" rev-list --count HEAD --not --remotes=origin         # > 0 = unpushed
```

Verdicts, first match wins:

1. **keep (new)**: the tip equals `ccBase`, or there is no `ccBase` and the
   branch reflog has a single entry (no commits since it was created). A
   fresh worktree from `/cc-manage` is never merged or idle.
2. **merged**: the tip is an ancestor of `defaultRef` (`in-default`).
3. **idle**: the last own commit (or, without one, the branch creation time)
   is more than N days ago.
4. **keep**: everything else.

Flags, shown next to any verdict: **dirty**, **unpushed** (commits on no
`origin` branch), **detached**, and the CC sessions in that folder (agents
whose `cwd` is the folder: how many, and whether any is `live`, i.e.
running now).

## 4. Show the table

Show every folder, kept ones included:

| # | Repo | Folder | Branch | Verdict | Why | Flags |
|---|------|--------|--------|---------|-----|-------|

The candidates are the **merged**, **idle** and **orphaned** rows. If there
are none, say so and stop. Point out running sessions: removal stops them.

## 5. Confirm

Use AskUserQuestion, one call with two questions:

1. Which folders to remove (header `Remove`).
   - Up to 4 candidates: `multiSelect: true`, one option per candidate
     (`#<n> <repo>/<folder>`, with its verdict in the description).
   - More than 4: single-select options `All merged (<k>)`,
     `All merged and idle (<k>)`, `Pick by number` and `Cancel`. For `Pick by
     number`, or any free-text answer, take the row numbers the user types
     (e.g. `1, 3, 7-9`); every candidate can be picked this way.
2. Delete the local branches too? (header `Branches`): `Delete if merged`
   (recommended) or `Keep branches`.

`Cancel` or nothing selected → stop; say that nothing was removed.

Orphaned folders in the selection get their own confirmation before anything
is deleted: list them and ask "Delete these folders from disk?" (`Delete` /
`Keep`).

## 6. Remove, folder by folder

Handle one folder at a time; if one fails, report it and go on.

**A folder with CC sessions** (any agent with that `cwd`, live or sleeping):

```bash
node "$CC_CLI" forget <<'CC_ARGS_EOF'
{"cwd": "<folder>", "removeWorktree": true, "deleteBranch": <true or false>}
CC_ARGS_EOF
```

CC stops every session there, waits for them to exit, removes the worktree
(retrying a locked folder, then `git worktree prune`), takes the sessions off
the sidebar, and deletes the branch only if it is merged into `defaultRef`.
It prints `{ ok, branch, branchDeleted, branchKept?, needsForce?, error? }`.

- `needsForce: true`: the worktree is dirty; nothing was removed and its
  sessions are now sleeping. Show `git -C "<folder>" status --short` and ask,
  for this folder alone, "Remove <folder> and lose these changes?"
  (`Remove anyway` / `Keep`). Only on `Remove anyway`, call again with
  `"force": true` added:
  ```bash
  node "$CC_CLI" forget <<'CC_ARGS_EOF'
  {"cwd": "<folder>", "removeWorktree": true, "deleteBranch": <true or false>, "force": true}
  CC_ARGS_EOF
  ```
- `noSessions: true`: CC has no session there after all; use the steps below.
- Any other error (for example CC refusing the folder): report it, change
  nothing else for this folder.

**A worktree without CC sessions:**

```bash
git -C "<dir>" worktree remove "<folder>"
```

If git refuses because the worktree is dirty, ask the same force question
first; only then run `git -C "<dir>" worktree remove --force "<folder>"`.
Then `git -C "<dir>" worktree prune`. If branches are to be deleted:

```bash
git -C "<dir>" merge-base --is-ancestor "<branch>" "<defaultRef>" && git -C "<dir>" branch -D "<branch>"
```

If the ancestor check fails, keep the branch and report it as unmerged.

**An orphaned folder** (only after its own confirmation): check once more
that it is exactly two levels below `worktreeRoot`, then

```bash
rm -rf "<folder>"
```

and, if its repo is known, `git -C "<dir>" worktree prune`.

## 7. Report

Per folder: `removed`, `kept (dirty, not forced)`, or `failed: <error>`;
per branch: `deleted`, `kept: not merged into <defaultRef>` or `kept (by
choice)`. Mention the sessions that left the sidebar.
