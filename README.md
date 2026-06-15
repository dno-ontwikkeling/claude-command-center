# Claude Command Center

Desktop app to run and monitor multiple Claude Code agents from one window —
no more hunting through terminal windows to find which is which.

Each agent is a `claude` session the app launches and **owns** (PTY-backed), so
you get full control (type, approve, kill, restart) and a live view of every
session in one place.

## Features

- **Sidebar** — every agent with project folder + live status dot
  (busy · idle · needs-input · exited) and its last activity line.
- **Embedded terminal** — full `xterm.js` terminal per agent, live PTY stream.
- **Control bar** — input box + quick keys (Enter, y, n, Esc, Ctrl-C, 1, 2) for
  fast permission-prompt answers without leaving the dashboard.
- **Launch from the app** — pick a project folder, spawn a Claude session (or a
  plain shell) in it.
- One-Dark / Fira Code aesthetic.

## Stack

Electron · node-pty · @xterm/xterm

## Run

```bash
npm install      # also rebuilds node-pty for Electron (postinstall)
npm start
```

The app finds `claude` at `~/.local/bin/claude(.exe)` or on your `PATH`.

## Status detection

State is inferred from the PTY stream:

- `busy` — output produced in the last ~1.5s
- `needs-input` — quiet **and** recent output matches a prompt pattern
  (`(y/n)`, `Do you want`, `❯`, …)
- `idle` — quiet, no prompt
- `exited` — process ended

## Roadmap

- JSONL transcript parsing for richer task/turn info
- Observe externally-launched agents (hybrid mode)
- Persist agent layout across restarts
- Desktop notification when an agent needs input
