# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron desktop app on Windows; the renderer is plain HTML/CSS/JS ES modules with no framework and no build step.)

## Users

One user: the developer who built it. They run many Claude Code agents at once across projects and git worktrees on one Windows PC. The app runs full-screen in long sessions and gets glanced at often.

## Product Purpose

Launch and monitor many Claude Code agents from one window. The main job is triage at a glance: see which agent needs you (needs-input, finished, error), then jump into its live terminal. Terminal work comes second to that.

Success: you never miss an agent that is waiting on you, and switching to it is instant.

## Positioning

Status comes from Claude Code lifecycle hooks, not from scraping terminal output, so the status dots are accurate. The same agents are also reachable from a paired phone app.

## Operating Context

- Projects and workspaces (git worktrees) live in a sidebar list. Each agent has a status dot with nine states: busy, idle, needs-input, rate-limited, done, unseen, error, dead, dormant.
- The stage shows the selected agent's xterm.js terminal and a git action bar: open in editor, fetch, pull, diff, find, Docs. The Docs button toggles a read-only panel on the right of the terminal that renders the agent folder's plans and reviews (.md and .html); it never opens by itself.
- Overlays: settings (General, Terminal, Notifications, Remote), worktree picker, confirm, prompt, smart-prompts manager.
- Agent menu: Rename, Sleep/Resume, Forget. List filter: All / Active / Sleeping.
- Supporting features: diff viewer, Docs panel, sounds and notifications, remote pairing.

## Capabilities and Constraints

- Every existing feature must stay.
- Dark and light themes have equal priority.
- The Content-Security-Policy allows only `'self'` for scripts and styles, so fonts and icons must be bundled locally.
- Renderer DOM IDs are wired from JS modules in `renderer/`.
- There are no DOM tests.

## Brand Commitments

Name: "Command Center". No logo, colors or voice are fixed.

## Product Principles

1. Attention is the scarce resource. An agent that needs you must stand out; everything else stays quiet.
2. Accurate over decorative. Status shown is status known.
3. The terminal is the work surface. Chrome around it recedes.
4. Built for long sessions. Nothing should fatigue the eye or demand attention without reason.
