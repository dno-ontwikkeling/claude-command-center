---
type: handoff
date: 2026-11-12 18:49
project: CommandCenter
---

## Goal
Let Claude Code steer Command Center (CC): `/cc-manage` turns a plan in a CC-launched chat into worktrees under `<wt-root>/<repo>/<feature>` (or workspaces under `<ws-root>/<name>`) with a running CC session each, started with a skill picked at run time. `/cc-clean-worktrees` finds merged, idle and orphaned worktrees under `<wt-root>` and, after confirmation, removes their sessions, worktrees and (optionally) branches. CC's folder pickers start from the two new default roots.

## Done
- Spec: `plans/claude-code-steering.spec.md` (brainstormed, then deepened; verdict go).
- Plan: `plans/claude-code-steering.md` (17 steps, base `5601b43`), deepened with gap analysis plus 4 research passes; 8 design questions answered by the user and recorded under Decisions.
- No code written yet.

## In progress
- Nothing half-done. The plan is ready for `/workflow:work`.

## Next steps
1. `/workflow:work plans/claude-code-steering.md`, starting at Step 1: a test of passing a prompt as a command-line argument through node-pty. Its result decides Step 7 (argument or bracketed-paste fallback); record it in the plan Log.
2. Steps 2–15 are TDD in electron-free modules (`ccpaths`, `worktreecheck`, `claudetrust`, `spawnargs`, `ccommand`, `hooks/cc.js`, `hooks/skillsync.js`) plus main and renderer wiring.
3. Steps 16–17: write the acceptance checklist and run it on the built app. This needs the user (real sessions, an NSIS update, an uninstall), so unattended runs stop there.

## Gotchas
- `gitops.js` requires `./logger`, which requires `electron`, so it can't be loaded under plain `node --test` in CI. New modules take an injected logger or none (pattern: `hookserver.js:23`).
- The hook server has `server.setTimeout(5000)` (`main.js:333`). `/command` must set `req.socket.setTimeout(130000)` on every request, or a long `forget` gets a connection reset.
- The renderer compares dirs with `===` (`renderer/state.js:36`). `ccommand` must substitute the stored record's exact `dir` string.
- Existing bug the plan fixes (Step 5): `worktree:remove` rejects the worktree of a session left sleeping from an earlier app run with "Unknown directory.", because `isKnownDir` only learns folders at spawn (`main.js:352`).
- `isWorktreeRegistered` (`gitops.js:79`) returns `true` when git fails, so it is useless as a validation check.
- An NSIS update runs the old uninstaller (`--updated`), which today also strips the status hooks. The plan guards both hooks and skills with `${ifNot} ${isUpdated}`. Its `!define` wasn't found in the templates; confirm it with a real update.
- `~/.claude.json` trust keys use forward slashes with casing kept (`C:/Github/Lansweeper.Packet`). Running Claude sessions rewrite that file, so read right before writing and only add the missing flag.
- Bypass mode does not skip Claude's "trust this folder?" prompt, and the positional prompt waits until it is accepted.
- Inside Claude Code on Windows, Bash stdin can be an open pipe that never closes, so `cc.js` gives up on stdin after 500 ms with no data.
- `typecheck` covers only `preload.js` and `types/ipc.d.ts`. Steps that touch `main.js` verify with `node --check main.js` plus `npm test`.
- Alternative rejected: the skill launching `claude --bg` and registering the session id (no status until opened, attach interrupts the turn, environment leak). See the spec Log.

## Files touched
- plans/claude-code-steering.spec.md
- plans/claude-code-steering.md
- plans/handoff-claude-code-steering.md
