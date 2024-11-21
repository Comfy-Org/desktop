!include 'LogicLib.nsh'
!include "StrFunc.nsh"

${UnStrStr}

; The following is used to add the "/SD" flag to MessageBox so that the
; machine can restart if the uninstaller fails.
!macro customUnInstallCheckCommon
  IfErrors 0 +3
  DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  Return

  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0" /SD IDOK
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endif}
!macroend

!macro customUnInstallCheck
  !insertmacro customUnInstallCheckCommon
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheckCommon
!macroend

Section "WriteUninstaller"
    WriteUninstaller $INSTDIR\uninstaller.exe
SectionEnd

!macro customUnInstall
  ClearErrors
  FileOpen $0 "$APPDATA\ComfyUI\extra_models_config.yaml" r
  var /global line
  FileRead $0 $line
  ${DoUntil} ${Errors}
    ${UnStrStr} $1 $line "base_path:" ; Find base_path prefix in the line
    ${If} $1 != ""
      StrCpy $2 $1 1024 10 ; Strip off first 10 characters (base_path:)

      ; $2 now contains value of base_path
      RMDir /r "$2\.venv"
      RMDir /r "$2\uv-cache"
    ${EndIf}
    FileRead $0 $line
  ${LoopUntil} 1 = 0

  FileClose $0
  Delete "$APPDATA\ComfyUI\extra_models_config.yaml"
!macroend
