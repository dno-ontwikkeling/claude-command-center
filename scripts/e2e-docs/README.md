# Docs panel end-to-end check (Windows)

Manual, scripted run of the real Electron app against a throwaway fixture. Not
part of `npm test`. Used for story 010 of `plans/docs-management.md`.

```bash
# 1. Electron binary (first time only; `npm start` would also fetch it)
node node_modules/electron/install.js

# 2. Fixture: %TEMP%\cc-docs-e2e\{repo, repo-wt, home, userdata, shots}
node scripts/e2e-docs/fixture.js

# 3. Launch with a throwaway HOME (the hooks prompt and the spawned `claude`
#    never touch your real ~/.claude) and an isolated profile. Use the long
#    temp path the fixture printed, not the 8.3 short form.
USERPROFILE='<E2E>\home' HOME='<E2E>\home' ./node_modules/electron/dist/electron.exe . \
  '--user-data-dir=<E2E>\userdata' --remote-debugging-port=9334

# 4. Drive it (CDP_PORT defaults to 9333)
CDP_PORT=9334 node scripts/e2e-docs/cdp.js eval "document.title"
CDP_PORT=9334 node scripts/e2e-docs/cdp.js click "#sb-docs"
CDP_PORT=9334 node scripts/e2e-docs/cdp.js shot 01-panel     # -> <E2E>\shots\01-panel.png
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-docs/recycle.ps1 -Prefix "a (2)"
```

Gotchas found while running it:

- **8.3 temp paths.** `os.tmpdir()` can be `C:\Users\OLIVIE~1.NEE\...` while git
  reports worktrees by long path; dir matching is by string, so the fixture
  uses the long path. Do the same for anything you register by hand.
- **The 1 s poll pauses while the window is hidden** (screen locked or
  occluded). Config changed behind the panel's back only shows after reopening
  the panel; Save in the Folders overlay reloads directly.
- **The CDP port can stay taken after quitting.** Open in VS Code started from
  the app inherits the devtools listening socket, so a relaunch on the same
  port fails with "Cannot start http server for devtools". Use another port.
- **Add folder opens a native folder dialog** that CDP cannot drive. Test the
  overlay's Save path through the UI and set folders through
  `window.api.setDocConfig({ dir, folders, exts })` (the same IPC Save calls).
- **Re-adding a project** also uses a native dialog: quit, write
  `[{ "dir": ..., "name": ... }]` to `userdata\projects.json` (what
  `addProjectDir` writes), relaunch.
