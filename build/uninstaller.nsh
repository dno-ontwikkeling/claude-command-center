; Custom NSIS uninstall hook for electron-builder.
; On a real uninstall, removes what this install wrote into the user's Claude
; config, so nothing is left pointing at deleted files:
;   - the status hooks in ~/.claude/settings.json (an orphaned hook pointing at
;     a deleted report.js would make every future Claude Code session throw
;     "Cannot find module");
;   - the bundled skills in ~/.claude/skills that Command Center installed and
;     the user hasn't edited (see hooks/skillsync.js).
;
; An app update also runs the old uninstaller (with --updated). Then nothing is
; removed: the new version keeps using the same hooks and skills, and the user
; isn't asked to install them again after every update.
;
; Why customUnInit: it runs in un.onInit, before any files are removed, while
; $INSTDIR\resources\app.asar.unpacked\hooks\uninstall-hooks.js still exists.
; customUnInstall can run after electron-builder has already deleted the app
; folder.
;
; Requires `node` on PATH — the hook mechanism itself already relies on that.
; Non-fatal: nsExec's result is popped and ignored so a missing node or script
; never blocks uninstall. Idempotent (un.onInit may run twice when NSIS relaunches
; the uninstaller from a temp copy); the second run simply removes nothing.

!macro customUnInit
  ${ifNot} ${isUpdated}
    DetailPrint "Removing Command Center status hooks and skills from ~/.claude"
    nsExec::Exec 'cmd /c node "$INSTDIR\resources\app.asar.unpacked\hooks\uninstall-hooks.js"'
    Pop $0
  ${endIf}
!macroend
