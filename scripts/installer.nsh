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
  Var /GLOBAL isDeleteUpdateCache
  Var /GLOBAL chkDeleteUpdateCache
  Var /GLOBAL isResetSettings
  Var /GLOBAL chkResetSettings
  Var /GLOBAL radPresetFull
  Var /GLOBAL radPresetCustom
  Var /GLOBAL isDeleteVenv
  Var /GLOBAL chkDeleteVenv

  ; Insert a custom page right after the Uninstall Welcome page
  !macro customUnWelcomePage
    ; Keep the default welcome screen
    !insertmacro MUI_UNPAGE_WELCOME
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

    ${NSD_CreateRadioButton} 0 36u 100% 12u "Remove everything"
    Pop $radPresetFull
    ${NSD_CreateRadioButton} 0 52u 100% 12u "Remove selected components"
    Pop $radPresetCustom
    ${NSD_SetState} $radPresetCustom 1
    ${NSD_OnClick} $radPresetFull un.PresetFull_OnClick
    ${NSD_OnClick} $radPresetCustom un.PresetCustom_OnClick

    ${NSD_CreateCheckBox} 10u 68u 100% 12u "Remove ComfyUI data in %APPDATA%"
    Pop $chkDeleteComfyUI
    StrCpy $isDeleteComfyUI "1"
    ${NSD_SetState} $chkDeleteComfyUI 1

    ; Move .venv to #2
    ${NSD_CreateCheckBox} 10u 82u 100% 12u "Remove Python virtual env (.venv)"
    Pop $chkDeleteVenv
    StrCpy $isDeleteVenv "1"
    ${NSD_SetState} $chkDeleteVenv 1

    ${NSD_CreateCheckBox} 10u 96u 100% 12u "Remove any temporary update files"
    Pop $chkDeleteUpdateCache
    StrCpy $isDeleteUpdateCache "1"
    ${NSD_SetState} $chkDeleteUpdateCache 1

    ${NSD_CreateCheckBox} 10u 110u 100% 12u "Reset ComfyUI settings"
    Pop $chkResetSettings
    StrCpy $isResetSettings "0"
    ${NSD_SetState} $chkResetSettings 0

    ; base_path moved to bottom; add warning marker in label
    ${NSD_CreateCheckBox} 10u 124u 100% 12u "Remove base_path directory (from config)"
    Pop $chkDeleteBasePath
    StrCpy $isDeleteBasePath "0"
    ${NSD_SetState} $chkDeleteBasePath 0

    nsDialogs::Show
  FunctionEnd

  Function un.SetCheckboxesEnabled
    Exch $0
    EnableWindow $chkDeleteComfyUI $0
    EnableWindow $chkDeleteBasePath $0
    EnableWindow $chkDeleteUpdateCache $0
    EnableWindow $chkResetSettings $0
    EnableWindow $chkDeleteVenv $0
    Pop $0
  FunctionEnd

  Function un.PresetFull_OnClick
    Pop $0
    Push 0
    Call un.SetCheckboxesEnabled
  FunctionEnd

  Function un.PresetCustom_OnClick
    Pop $0
    Push 1
    Call un.SetCheckboxesEnabled
  FunctionEnd

  Function un.ExtraUninstallPage_Leave
    ; If Full preset selected, apply selections on leave
    ${NSD_GetState} $radPresetFull $1
    ${If} $1 == 1
      ${NSD_SetState} $chkDeleteComfyUI 1
      ${NSD_SetState} $chkDeleteBasePath 1
      ${NSD_SetState} $chkDeleteUpdateCache 1
      ${NSD_SetState} $chkResetSettings 1
      ${NSD_SetState} $chkDeleteVenv 1
    ${EndIf}

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

    ${NSD_GetState} $chkDeleteUpdateCache $0
    ${If} $0 == 1
      StrCpy $isDeleteUpdateCache "1"
    ${Else}
      StrCpy $isDeleteUpdateCache "0"
    ${EndIf}
    ${NSD_GetState} $chkResetSettings $0
    ${If} $0 == 1
      StrCpy $isResetSettings "1"
    ${Else}
      StrCpy $isResetSettings "0"
    ${EndIf}
    ${NSD_GetState} $chkDeleteVenv $0
    ${If} $0 == 1
      StrCpy $isDeleteVenv "1"
    ${Else}
      StrCpy $isDeleteVenv "0"
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
        ${if} $isDeleteVenv == "1"
          DetailPrint "Removing Python virtual env: $3\.venv"
          RMDir /r /REBOOTOK "$3\\.venv"
        ${endIf}
        ${if} $isDeleteBasePath == "1"
          DetailPrint "Removing base_path directory: $3"
          RMDir /r /REBOOTOK "$3"
          ${ExitDo}
        ${endIf}

        DetailPrint "Removing cache directory: $3\uv-cache"
        RMDir /r /REBOOTOK "$3\uv-cache"
        ${if} $isResetSettings == "1"
          DetailPrint "Removing user preferences: $3\user\default\comfy.settings.json"
          Delete "$3\user\default\comfy.settings.json"
        ${endIf}

        ${ExitDo} ; No need to continue, break the cycle
      ${EndIf}
      FileRead $0 $line
    ${LoopUntil} 1 = 0

    FileClose $0
  ${endIf}
  ${if} $isDeleteComfyUI == "1"
    DetailPrint "Removing ComfyUI AppData: $APPDATA\ComfyUI"
    RMDir /r /REBOOTOK "$APPDATA\ComfyUI"
  ${endIf}

  ${if} $isDeleteUpdateCache == "1"
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    ; APP_INSTALLER_STORE_FILE is defined by electron-builder; it is the relative path
    ; to the copy of the installer stored under %LOCALAPPDATA% for update flows
    !ifdef APP_INSTALLER_STORE_FILE
      DetailPrint "Deleting cached installer: $LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
      Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    !endif
    ; APP_PACKAGE_STORE_FILE is defined when using a web/remote package; it is the
    ; cached app package stored under %LOCALAPPDATA%
    !ifdef APP_PACKAGE_STORE_FILE
      DetailPrint "Deleting cached package: $LOCALAPPDATA\${APP_PACKAGE_STORE_FILE}"
      Delete "$LOCALAPPDATA\${APP_PACKAGE_STORE_FILE}"
    !endif
    DetailPrint "Removing update cache dir: $LOCALAPPDATA\@comfyorgcomfyui-electron-updater"
    RMDir /r /REBOOTOK "$LOCALAPPDATA\@comfyorgcomfyui-electron-updater"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${endIf}

  ; Attempt to remove install dir if empty; keep if not empty
  ClearErrors
  RMDir $INSTDIR
  IfErrors +3 0
  DetailPrint "Removed install dir: $INSTDIR"
  Goto +2
  DetailPrint "Install dir not empty; leaving in place."
!macroend
