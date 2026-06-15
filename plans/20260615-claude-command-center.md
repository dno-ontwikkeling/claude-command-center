# Feature: Claude Command Center

Date: 2026-06-15
Status: Approved

## Problem

Running multiple Claude Code agents in separate terminal windows. No way to tell
which window maps to which project or what each agent is doing right now. Hard to
spot agents blocked on a permission prompt. Constant context-switching between
windows.

## Decision

Build an **Electron desktop app** that **owns** the agents. Instead of opening
terminals manually, you launch each `claude` session from inside the app. The app
spawns each agent as a PTY-backed child process (`node-pty`), so it controls
stdin/stdout fully:

- **Sidebar** — list of all agents with project name + status dot
  (busy / idle / needs-input).
- **Main pane** — embedded terminal (`xterm.js`) streaming the selected agent's
  live output, plus a control bar (input box, approve y/n, kill, restart).
- **Status deriver** — infers state from the PTY stream (output activity +
  prompt-pattern detection).

Full control is native because the app owns the pipe. Live feed = the PTY stream.

### Visual style (matches `pewdiepie-archdaemon/odysseus`)

- Dark One-Dark base: bg `#282c34`, fg `#9cdef2`, panel `#111`, border `#355a66`
- Accent cyan/blue `#00aaff`, active-green `#00ff00`, warn `#f0ad4e`, danger `#e06c75`
- Font: **Fira Code**, monospace, 14px base
- Spacing 8px scale; radius 4/8/16px; soft shadows

## Alternatives Considered

- **A — Observe via JSONL/hooks + OS window control.** Keep agents in their own
  terminals; raise window + simulate keystrokes for control. Rejected: input
  injection into foreign windows is fragile.
- **C — Hybrid (observe-any + own-when-launched).** Best coverage but two control
  paths. Deferred; revisit once B works.

## Implementation Notes

- Stack: Electron + `node-pty` + `@xterm/xterm` (+ fit addon).
- `node-pty` is native → rebuild for Electron via `@electron/rebuild` postinstall.
- Resolve `claude` executable: check `~/.local/bin/claude.exe`, then PATH.
- Status states: `busy` (output in last ~1.5s), `idle` (quiet), `needs-input`
  (prompt pattern matched in recent buffer).
- Per-agent: id, name, projectDir, pty handle, status, lastActivity, ring buffer
  of recent output (for status + "last activity" line in sidebar).

### Simplest version (v1)

Spawn/list/select/kill agents; live xterm per agent; status dots; input box +
common-key buttons (Enter, y, n, Esc, Ctrl-C). No JSONL parsing, no persistence,
no multi-window. That alone kills the core pain.
