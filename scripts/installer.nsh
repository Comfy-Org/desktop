!include 'LogicLib.nsh'
!include 'nsDialogs.nsh'

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

!ifdef BUILD_UNINSTALLER
  Var /GLOBAL isDeleteComfyUI
  Var /GLOBAL chkDeleteComfyUI
  Var /GLOBAL isDeleteBasePath
  Var /GLOBAL chkDeleteBasePath
  ; Insert a custom page right after the Uninstall Welcome page
  !macro customUnWelcomePage
    ; Keep the default welcome screen
    !insertmacro MUI_UNPAGE_WELCOME
    ; Then show our extra page with a checkbox
    UninstPage custom un.ExtraUninstallPage_Create un.ExtraUninstallPage_Leave
  !macroend

  Function un.ExtraUninstallPage_Create
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 12u "Uninstall options"
    Pop $1
    ${NSD_CreateLabel} 0 14u 100% 24u "Choose whether to remove ComfyUI data stored in %APPDATA%."
    Pop $1

    ${NSD_CreateCheckBox} 0 44u 100% 12u "Remove ComfyUI data in %APPDATA%"
    Pop $chkDeleteComfyUI
    ; default to not deleting
    StrCpy $isDeleteComfyUI "0"
    ${NSD_SetState} $chkDeleteComfyUI 0

    ${NSD_CreateCheckBox} 0 62u 100% 12u "Remove base_path directory (from config)"
    Pop $chkDeleteBasePath
    StrCpy $isDeleteBasePath "0"
    ${NSD_SetState} $chkDeleteBasePath 0

    nsDialogs::Show
  FunctionEnd

  Function un.ExtraUninstallPage_Leave
    ${NSD_GetState} $chkDeleteComfyUI $0
    ${If} $0 == 1
      StrCpy $isDeleteComfyUI "1"
    ${Else}
      StrCpy $isDeleteComfyUI "0"
    ${EndIf}

    ${NSD_GetState} $chkDeleteBasePath $0
    ${If} $0 == 1
      StrCpy $isDeleteBasePath "1"
    ${Else}
      StrCpy $isDeleteBasePath "0"
    ${EndIf}
  FunctionEnd
!endif

!macro customRemoveFiles
  ${ifNot} ${isUpdated}
    ClearErrors
    FileOpen $0 "$APPDATA\ComfyUI\extra_models_config.yaml" r
    var /global line
    var /global lineLength
    var /global prefix
    var /global prefixLength
    var /global prefixFirstLetter

    FileRead $0 $line

    StrCpy $prefix "base_path: " ; Space at the end is important to strip away correct number of letters
    StrLen $prefixLength $prefix
    StrCpy $prefixFirstLetter $prefix 1
    
    StrCpy $R3 $R0
    StrCpy $R0 -1
    IntOp $R0 $R0 + 1
    StrCpy $R2 $R3 1 $R0
    StrCmp $R2 "" +2
    StrCmp $R2 $R1 +2 -3
  
    StrCpy $R0 -1

    ${DoUntil} ${Errors}
      StrCpy $R3 0 ; Whitespace padding counter
      StrLen $lineLength $line

      ${Do} ; Find first letter of prefix
          StrCpy $R4 $line 1 $R3

          ${IfThen} $R4 == $prefixFirstLetter ${|} ${ExitDo} ${|}
          ${IfThen} $R3 > $lineLength ${|} ${ExitDo} ${|}

          IntOp $R3 $R3 + 1
      ${Loop}

      StrCpy $R2 $line $prefixLength $R3 ; Copy part from first letter to length of prefix

      ${If} $R2 == $prefix
        StrCpy $2 $line 1024 $R3 ; Strip off whitespace padding
        StrCpy $3 $2 1024 $prefixLength ; Strip off prefix

        ; $3 now contains value of base_path
        RMDir /r /REBOOTOK "$3\.venv"
        RMDir /r /REBOOTOK "$3\uv-cache"
        ${if} $isDeleteBasePath == "1"
          RMDir /r /REBOOTOK "$3"
        ${endIf}

        ${ExitDo} ; No need to continue, break the cycle
      ${EndIf}
      FileRead $0 $line
    ${LoopUntil} 1 = 0

    FileClose $0
  ${endIf}
  ${if} $isDeleteComfyUI == "1"
    RMDir /r /REBOOTOK "$APPDATA\ComfyUI"
  ${endIf}
!macroend
