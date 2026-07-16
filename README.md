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
The hook (`hooks/report.js`) is **env-gated**: it only reports when `CC_PORT`,
`CC_AGENT_ID`, and `CC_SECRET` are set, which the app injects when *it* spawns an
agent. Sessions you open manually in a normal terminal are unaffected.

The local HTTP server binds to `127.0.0.1` and requires the per-run `CC_SECRET`
(sent as an `x-cc-secret` header) and a live `agentId`, so another local process
can't spoof status events.

```
hook event ──> report.js ──POST (x-cc-secret)──> app HTTP server ──> sidebar dot
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

## Development

### Architecture

Electron, two processes with a curated IPC bridge (`contextIsolation: true`,
`nodeIntegration: false`, `preload.js` exposes a fixed `window.api`).

- **Main** (`main.js`) — window/lifecycle, IPC handlers, PTY management, the
  localhost hook server, and external-tool launchers. Pure/dependency-free logic
  is split into small, testable modules:
  - `jsonstore.js` — corruption-resistant JSON IO (`readJsonSafe`,
    `writeJsonAtomic`) + `hasShellMeta` path-safety check.
  - `gitinfo.js` — `.git/HEAD` branch reading, project-type detection, and the
    `git` porcelain output parsers.
  - `logger.js` — leveled logger, rotating file at `userData/logs/main.log`
    (`CC_LOG_LEVEL` controls verbosity); renderer logs are forwarded here too.
- **Renderer** (`renderer/`) — ES modules. `state.js` holds shared state and a
  small pub/sub (`onAgentsChanged`) so `agents.js` no longer imports the sidebar.
  Pure helpers are isolated for testing: `diff-parse.mjs` (unified-diff parser),
  `tui-signals.mjs` (terminal-output status classifier).

### Testing

Zero-dependency unit tests via Node's built-in runner. They cover the
electron-free modules (no `npm install` needed to run them):

```bash
npm test        # node --test
```

CI (`.github/workflows/ci.yml`) runs the suite on every push and pull request.

### Logging

Runtime logs go to `userData/logs/main.log` (and the console under `npm start`).
Set `CC_LOG_LEVEL=debug` for verbose output.
