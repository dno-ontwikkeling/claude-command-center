# Claude Command Center

Minimal desktop app to launch and monitor multiple Claude Code agents from one
window. Each project you add can be launched as a live, interactive terminal,
with a status dot that reflects what the agent is doing right now.

## Features (v1)

- **Saved project list** — add a folder once, click to launch an agent there.
- **Live terminal** — full interactive `claude` session per project (xterm.js +
  PTY). Type as you would in a normal terminal.
- **Accurate status** — status comes from Claude Code lifecycle hooks, not from
  scraping terminal output:
  - `busy` — agent is working
  - `needs-input` — blocked on a permission / prompt (the one to watch)
  - `idle` — turn finished, waiting for you
  - `dead` — session ended
- **Light / dark theme** — follows OS by default, toggle in the sidebar.

## How status works

On first run the app offers to add lifecycle hooks to `~/.claude/settings.json`.
The hook (`hooks/report.js`) is **env-gated**: it only reports when `CC_PORT` and
`CC_AGENT_ID` are set, which the app injects when *it* spawns an agent. Sessions
you open manually in a normal terminal are unaffected.

```
hook event ──> report.js ──POST──> app HTTP server ──> sidebar dot
```

## Stack

- Electron
- `@lydell/node-pty` — PTY-backed child processes (full stdin/stdout control)
- `@xterm/xterm` + `@xterm/addon-fit` — terminal UI
- Plain CSS with custom-property theme tokens (no framework, no build step)

## Run

```bash
npm install
npm start
```

`claude` is resolved from `~/.local/bin/claude(.exe)`, falling back to `PATH`.
