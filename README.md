# Claude Command Center

Minimal desktop app to launch and monitor multiple Claude Code agents from one
window. Each project you add can be launched as a live, interactive terminal,
with a status dot that reflects what the agent is doing right now.

## Features (v1)

- **Saved project list** — add a folder once, click to launch an agent there.
- **Live terminal** — full interactive `claude` session per project (xterm.js +
  PTY). Type as you would in a normal terminal.
- **Agent menu** — every agent has the same menu on the desktop and the phone:
  **Rename**, **Sleep** (stop the session but keep it in the list) or
  **Resume**, and **Forget** (stop it and drop it from the list; for a worktree
  you can also delete its folder and branch — the session is stopped first so
  no file stays locked). Clicking a sleeping agent resumes it. Filter the list
  with **All / Active / Sleeping**.
- **Accurate status** — status comes from Claude Code lifecycle hooks, not from
  scraping terminal output:
  - `busy` — agent is working
  - `needs-input` — blocked on a permission / prompt (the one to watch)
  - `idle` — turn finished, waiting for you
  - `dead` — session ended
- **Docs panel** — a **Docs** button in the stage bar opens a panel beside the
  terminal with the active agent's docs (`.md` and `.html`), newest first. Pick
  one from the dropdown (type to filter); edits and new files show up within
  about a second. Desktop only.
  - **Folders** — `plans/` and `reviews/` by default. **⋮ → Folders…** picks
    other folders per project or workspace (for example `docs`, or the project
    root for `README.md` and friends); every worktree of the project uses the
    same list. Each folder's `archive/` is listed as a collapsed **Archived**
    group. The list is stored with the project in the app, so forgetting the
    project removes it; nothing is written into your repo.
  - **Actions** on the shown doc (**⋮**): **Archive** (move into the folder's
    `archive/`) / **Restore**, **Open in VS Code**, **Show in Explorer**, and
    **Move to Recycle Bin** (asks first). A name clash gets a ` (2)` suffix;
    nothing is ever overwritten or permanently deleted.
- **Light / dark theme** — follows OS by default, toggle in the sidebar.
- **Remote access from your phone** (opt-in) — a sideloaded Android app shows
  the same agents and status, opens their terminals, has the same agent menu,
  adds projects and workspaces, shows diffs and the conversation history,
  fetches / pulls, and notifies you when an agent needs input. See
  [Remote access](#remote-access). The phone notifies you when an agent needs
  input and when it finishes a turn.

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

## Remote access

Work on this PC's agents from your phone with the **CommandCenter remote** Android app
(`mobile/`). Remote access is **off by default**.

```
phone app ──WSS (pinned cert + token)──> Command Center ──> the same ptys / agents
```

### Reaching the PC

- **Tailscale (recommended).** Install Tailscale on the PC and the phone. The PC
  gets a stable `100.x.y.z` address that only your devices can reach, so nothing
  is exposed to the internet. Command Center offers that address first.
- **Port forwarding.** Forward a TCP port on your router to the PC (default
  `47820`) and enter your public IP or DDNS name under **Phone connects to**.
  This puts a server that can type into your terminals on the internet; it is
  protected by TLS, the token and a lockout (below), but Tailscale is safer.

Windows Firewall asks the first time the server listens: allow **private
networks** (and public only if you really need it).

### Pairing

1. **Settings → Remote**: turn on **Remote access**. The status line shows
   where it listens, or why it couldn't (port in use, firewall).
2. Click **Show pairing QR** and scan it with CommandCenter remote.
3. The phone connects while its app is open. With the app closed it gets
   alerts as push notifications instead (see below).

- **Disconnect all** kicks connected phones; they keep their pairing and can
  reconnect.
- **Regenerate** creates a new token *and* certificate: every phone is
  disconnected and must scan the new QR. Use it if a phone is lost or the QR
  leaked.
- The pairing survives restarts of both apps. If the PC's address changes (LAN
  IP, no Tailscale), re-scan the QR.

### Background alerts (Firebase Cloud Messaging)

The phone keeps no connection in the background. When an agent needs input or
finishes a turn, the PC pushes an alert through Firebase Cloud Messaging (free,
no billing account needed); tapping it opens that agent. Setup, once:

1. Create a project in the [Firebase console](https://console.firebase.google.com)
   and add an **Android app** with the id `com.olivier.commandcenter.remote`.
2. Download `google-services.json` and put it in `mobile/android/app/`
   (git-ignored), then build and install the app. For release builds, store it
   base64-encoded in the repo secret `GOOGLE_SERVICES_JSON_BASE64`. Without it
   the app builds without alerts.
3. The PC signs pushes with a service account that can **only send**: in
   Google Cloud Console create a custom role with just
   `cloudmessaging.messages.create`, grant it to a new service account on the
   project, and create a JSON key for it. Store the key base64-encoded in the
   repo secret `FCM_SERVICE_ACCOUNT_BASE64`; release builds bundle it. For a
   dev run, put it in `bundled/fcm-key.json` (git-ignored).
4. Open the app on the phone once so it registers, then **Send test**.

Regenerating the pairing clears the phone's registration; it registers again
the next time it connects.

### Phone or desktop: one has control

An agent's terminal is drawn for one screen size at a time, so one device has
control of it:

- **Opening an agent on the phone takes control.** Command Center restarts the
  session (`claude --resume`) at the phone's size, so Claude reprints the
  conversation at that width and the phone can scroll through it cleanly.
- The desktop then shows **Working remotely** instead of the terminal, with a
  **Take over** button that restarts the session at the desktop's size. The
  phone in turn shows **Working on host** with its own Take over.
- A restart in the middle of a turn interrupts it: type `continue` to pick it
  up. A pending permission question is asked again.
- An agent you haven't sent a prompt to has no session to resume yet: it is
  just resized and repainted.

### Security model

- **TLS with a pinned self-signed certificate.** The QR carries the
  certificate's SHA-256 fingerprint; the phone trusts exactly that certificate,
  no CA, so a man in the middle can't impersonate the PC.
- **256-bit token, checked before any WebSocket exists.** A wrong token gets
  HTTP 401; 5 failures from one IP lock it out for 15 minutes (in memory: an app
  restart resets it). Connections and failures are logged with the IP, never the
  token.
- **Token encrypted at rest** — on the PC with the OS keystore (`safeStorage`,
  DPAPI on Windows), on the phone with the Android Keystore; phone backups are
  disabled so it can't be restored onto another device.
- **A leaked QR code equals full access** to your agents. Show it only when
  pairing; Regenerate if a screenshot of it got out.
- **Bypass permissions applies to phone-started agents too.** If it's on, an
  agent started from the phone skips permission prompts (and never raises a
  needs-input alert for them). Settings → Remote warns when both are on.
- Remote clients can only start agents in saved projects / workspaces and their
  registered worktrees, and only run the same guarded git commands as the UI.

The phone app itself — building, sideloading and the release keystore — is
documented in [`mobile/README.md`](mobile/README.md).

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
  - Remote access: `remoteserver.js` (WSS server, auth at upgrade),
    `remoteproto.js` (protocol v1 frames + per-connection handler),
    `remoteauth.js` (token, lockout, pairing code), `remotecert.js` (pinned
    self-signed cert), `ringbuffer.js` (per-agent scrollback for replay). The
    protocol contract lives in `test/fixtures/remote-proto/`, shared with the
    phone app's JS and Kotlin tests.
- **Renderer** (`renderer/`) — ES modules. `state.js` holds shared state and a
  small pub/sub (`onAgentsChanged`, `onStatusChanged`) so `agents.js` no longer
  imports the sidebar. The renderer is the source of truth for agents: it mirrors
  the list to main for the phone and runs phone actions (`remote:command`).
  Pure helpers are isolated for testing: `diff-parse.mjs` (unified-diff parser),
  `tui-signals.mjs` (terminal-output status classifier), `remote-sync.mjs`
  (phone snapshot).
- **Phone app** (`mobile/`) — see [`mobile/README.md`](mobile/README.md).

### Testing

Unit tests via Node's built-in runner cover the electron-free modules. The
remote-access tests need the pure-JS dependencies (`ws`, `selfsigned`), so
install first — `--ignore-scripts` skips the Electron download and node-pty
build:

```bash
npm ci --ignore-scripts
npm test        # node --test "test/**/*.test.{js,mjs}"  (Node >= 21)
```

CI (`.github/workflows/ci.yml`) runs the suite on every push and pull request,
plus the phone app's tests and a debug APK build.

### Smoke-running a dev build

The installed app and `npm start` share one profile folder
(`%APPDATA%\claude-command-center`) and one single-instance lock: while the
installed app runs, a dev launch exits immediately, and anything a dev build
writes lands in your real profile. Use a throwaway profile:

```bash
npx electron . --user-data-dir=/path/to/scratch-profile
```

### Logging

Runtime logs go to `userData/logs/main.log` (and the console under `npm start`).
Set `CC_LOG_LEVEL=debug` for verbose output.
