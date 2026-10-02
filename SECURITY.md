# Security Policy

## Supported versions

This project is pre-1.0 and under active development. Only the latest release and
the `main` branch receive security fixes.

| Version | Supported |
| ------- | --------- |
| `main` / latest | :white_check_mark: |
| older releases  | :x: |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use one of the following private channels:

- Open a [GitHub security advisory](https://github.com/OlivierDeNeef/claude-command-center/security/advisories/new)
  (**Report a vulnerability**), or
- Email **olivier.de.neef@lansweeper.com** with the details.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (proof-of-concept if possible).
- Affected version, OS, and configuration.
- Any suggested mitigation.

You can expect an acknowledgement within **5 business days**. We will keep you
updated on the fix and coordinate a disclosure timeline with you. Please give us
a reasonable window to release a fix before any public disclosure.

## Scope

This is a local desktop application (Electron). Relevant to its threat model:

- **Local hook HTTP server** — binds to `127.0.0.1` only, and requires the
  per-run `CC_SECRET` (`x-cc-secret` header) plus a live `agentId` to accept
  status events, to prevent other local processes from spoofing them.
- **Renderer isolation** — `contextIsolation: true`, `nodeIntegration: false`;
  the renderer only reaches the main process through the fixed `window.api`
  bridge exposed in `preload.js`.
- **Settings modification** — the app can add lifecycle hooks to
  `~/.claude/settings.json`; hooks are env-gated so they only report for
  app-spawned agents.
- **Remote access server** (opt-in, off by default) — a WSS server that lets a
  paired phone type into agent terminals, start/stop agents and run git
  fetch/pull. It may face the internet (port forwarding). Controls: TLS with a
  self-signed certificate pinned by the phone; a 256-bit token checked at the
  HTTP upgrade (no WebSocket before auth); per-IP lockout after 5 failures;
  frame validation that closes on the first malformed frame; size limits; the
  token encrypted at rest on both ends; Regenerate to revoke all phones.
  Bypasses of any of these — or a way to reach a pty, spawn outside saved
  projects, or run other commands without the token — are in scope.
- **Phone app** (`mobile/`) — the certificate pin (`PinTrustManager`), token
  storage (Android Keystore) and the pairing QR format.

Reports about any of the above — or bypasses of these controls — are in scope.

## Out of scope

- Vulnerabilities in upstream dependencies (report those upstream; we track and
  bump them).
- Issues requiring an already-compromised local machine or physical access.
- Social-engineering or attacks against the `claude` CLI itself.
