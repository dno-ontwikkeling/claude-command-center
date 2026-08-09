# Contributing to Claude Command Center

Thanks for your interest in contributing! This document covers how to get set up
and the conventions the project follows.

## Getting started

```bash
npm install
npm start
```

`claude` is resolved from `~/.local/bin/claude(.exe)`, falling back to `PATH`.

## Development workflow

1. Fork the repo and create a branch off `main`.
2. Make your change, keeping the existing style (plain CSS, ES modules, no build
   step for the renderer).
3. Add or update tests for any electron-free logic you touch.
4. Run the checks below before opening a pull request.
5. Open a pull request against `main` with a clear description of the change.

## Checks

Run these locally before pushing — CI (`.github/workflows/ci.yml`) runs the same
suite on every push and pull request:

```bash
npm test        # node --test (built-in runner, no extra deps)
npm run typecheck
```

## Commit convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`. Use `!`
after the type/scope for a breaking change (e.g. `feat!: ...`).

Do not add `Co-Authored-By` lines.

## Architecture

See the **Development** section of [`README.md`](README.md) for the module layout
(main process, renderer, hook server, and the testable pure modules).

## Reporting issues

Open a GitHub issue with steps to reproduce, expected vs. actual behavior, and
your OS. Runtime logs at `userData/logs/main.log` (set `CC_LOG_LEVEL=debug` for
verbose output) help a lot.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
