; Deskoy NSIS customizations (electron-builder assisted installer).
; - Close running Deskoy without flashing a visible console (nsExec, same family as electron-builder).
; - Welcome + finish copy so the flow feels intentional, not “instant CMD”.
; - Fresh installs (not in-place updates) drop a marker so the app can reset local data once.

!macro customInit
  ; Hidden — no cmd.exe window. /F avoids “cannot be closed” prompts during overwrite.
  nsExec::Exec `taskkill /IM "${APP_EXECUTABLE_FILENAME}" /T /F`
  Pop $R0
!macroend

!macro customUnInit
  nsExec::Exec `taskkill /IM "${APP_EXECUTABLE_FILENAME}" /T /F`
  Pop $R0
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Deskoy Setup"
  !define MUI_WELCOMEPAGE_TEXT "This guided setup will install Deskoy on your computer.$\r$\n$\r$\nDeskoy lives in your system tray and helps you cover sensitive windows when you need privacy.$\r$\n$\r$\nFor the smoothest experience, close any other Deskoy windows first (check the tray icon too).$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "Deskoy is ready"
  !define MUI_FINISHPAGE_TEXT "Installation finished.$\r$\n$\r$\nThe first time you open Deskoy, you’ll enter your license and walk through a quick setup — hotkeys and other preferences start fresh on a new install.$\r$\n$\r$\nUse the Run checkbox below to open Deskoy now, or launch it later from the Start menu."
  !ifndef HIDE_RUN_AFTER_FINISH
    Function DeskoyStartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "Run Deskoy now"
    !define MUI_FINISHPAGE_RUN_FUNCTION "DeskoyStartApp"
  !endif
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customInstall
  ; Only true “new” installs — skip on silent in-place updates so settings stay put.
  ${ifNot} ${isUpdated}
    CreateDirectory "$INSTDIR\resources"
    ClearErrors
    FileOpen $0 "$INSTDIR\resources\deskoy-fresh-install.marker" w
    IfErrors deskoy_fresh_done
    FileWrite $0 "1"
    FileClose $0
    deskoy_fresh_done:
  ${endif}
!macroend
