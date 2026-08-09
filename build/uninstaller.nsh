; Custom NSIS uninstall hook for electron-builder.
; Removes the status hooks this install wrote into ~/.claude/settings.json so
; uninstalling doesn't leave an orphaned hook pointing at a deleted report.js
; (which would make every future Claude Code session throw "Cannot find module").
;
; IMPORTANT: electron-builder's uninstaller runs `RMDir /r $INSTDIR` (deleting
; the app, incl. our cleanup script) BEFORE the `customUnInstall` macro. So we
; hook `customUnInit` instead — it runs in un.onInit, before any files are
; removed, while $INSTDIR\resources\...\uninstall-hooks.js still exists.
;
; Requires `node` on PATH — the hook mechanism itself already relies on that.
; Non-fatal: nsExec's result is popped and ignored so a missing node or script
; never blocks uninstall. Idempotent (un.onInit may run twice when NSIS relaunches
; the uninstaller from a temp copy); the second run simply removes nothing.

!macro customUnInit
  DetailPrint "Removing Command Center status hooks from ~/.claude/settings.json"
  nsExec::Exec 'cmd /c node "$INSTDIR\resources\app.asar.unpacked\hooks\uninstall-hooks.js"'
  Pop $0
!macroend
