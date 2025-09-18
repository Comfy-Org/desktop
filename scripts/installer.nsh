!include 'LogicLib.nsh'
!include 'nsDialogs.nsh'

; Centralized strings, to be converted to i18n when practical
!define TITLE_CHOOSE        "Choose what to remove"
!define DESC_STANDARD       "Standard uninstall removes the app itself, its managed python packages, and the app settings. If you have custom model paths, you will need to re-add them if you reinstall."
!define DESC_CUSTOM         "Custom: choose specific items to remove."
!define LABEL_STANDARD      "Standard"
!define LABEL_CUSTOM        "Custom"
!define LABEL_APPDATA       "Remove ComfyUI data in %APPDATA%"
!define LABEL_VENV          "Remove Python virtual env (.venv)"
!define LABEL_UPDATECACHE   "Remove any temporary update files"
!define LABEL_RESETSETTINGS "Reset ComfyUI settings"
!define LABEL_BASEPATH      "Remove base_path directory (from config)"

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

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; Uninstall - Config / Functions
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

!ifdef BUILD_UNINSTALLER
  Var /GLOBAL isDeleteComfyUI
  Var /GLOBAL chkDeleteComfyUI
  Var /GLOBAL isDeleteBasePath
  Var /GLOBAL chkDeleteBasePath
  Var /GLOBAL isDeleteUpdateCache
  Var /GLOBAL chkDeleteUpdateCache
  Var /GLOBAL isResetSettings
  Var /GLOBAL chkResetSettings
  Var /GLOBAL radioRemoveStandard
  Var /GLOBAL radioRemoveCustom
  Var /GLOBAL isDeleteVenv
  Var /GLOBAL chkDeleteVenv
  Var /GLOBAL descLabel

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

    ${NSD_CreateLabel} 0 0 100% 12u "${TITLE_CHOOSE}"
    Pop $1
    ; Description label (default Standard)
    ${NSD_CreateLabel} 0 14u 100% 24u "${DESC_STANDARD}"
    Pop $descLabel

    ${NSD_CreateRadioButton} 0 36u 100% 12u "${LABEL_STANDARD}"
    Pop $radioRemoveStandard
    ${NSD_CreateRadioButton} 0 52u 100% 12u "${LABEL_CUSTOM}"
    Pop $radioRemoveCustom
    ${NSD_SetState} $radioRemoveStandard 1
    ${NSD_OnClick} $radioRemoveStandard un.PresetFull_OnClick
    ${NSD_OnClick} $radioRemoveCustom un.PresetCustom_OnClick

    ${NSD_CreateCheckBox} 10u 68u 100% 12u "${LABEL_APPDATA}"
    Pop $chkDeleteComfyUI
    StrCpy $isDeleteComfyUI "1"
    ${NSD_SetState} $chkDeleteComfyUI 1
    ${NSD_OnClick} $chkDeleteComfyUI un.Desc_ComfyData

    ${NSD_CreateCheckBox} 10u 82u 100% 12u "${LABEL_VENV}"
    Pop $chkDeleteVenv
    StrCpy $isDeleteVenv "1"
    ${NSD_SetState} $chkDeleteVenv 1
    ${NSD_OnClick} $chkDeleteVenv un.Desc_Venv

    ${NSD_CreateCheckBox} 10u 96u 100% 12u "${LABEL_UPDATECACHE}"
    Pop $chkDeleteUpdateCache
    StrCpy $isDeleteUpdateCache "1"
    ${NSD_SetState} $chkDeleteUpdateCache 1
    ${NSD_OnClick} $chkDeleteUpdateCache un.Desc_UpdateCache

    ${NSD_CreateCheckBox} 10u 110u 100% 12u "${LABEL_RESETSETTINGS}"
    Pop $chkResetSettings
    StrCpy $isResetSettings "0"
    ${NSD_SetState} $chkResetSettings 0
    ${NSD_OnClick} $chkResetSettings un.Desc_ResetSettings

    ${NSD_CreateCheckBox} 10u 124u 100% 12u "${LABEL_BASEPATH}"
    Pop $chkDeleteBasePath
    StrCpy $isDeleteBasePath "0"
    ${NSD_SetState} $chkDeleteBasePath 0
    ${NSD_OnClick} $chkDeleteBasePath un.Desc_BasePath

    ; Hide all checkboxes by default (shown when Custom is selected)
    Push 0
    Call un.SetCheckboxesVisible

    nsDialogs::Show
  FunctionEnd

  Function un.SetCheckboxesVisible
    Exch $0
    ${If} $0 == 0
      ShowWindow $chkDeleteComfyUI ${SW_HIDE}
      ShowWindow $chkDeleteBasePath ${SW_HIDE}
      ShowWindow $chkDeleteUpdateCache ${SW_HIDE}
      ShowWindow $chkResetSettings ${SW_HIDE}
      ShowWindow $chkDeleteVenv ${SW_HIDE}
    ${Else}
      ShowWindow $chkDeleteComfyUI ${SW_SHOW}
      ShowWindow $chkDeleteBasePath ${SW_SHOW}
      ShowWindow $chkDeleteUpdateCache ${SW_SHOW}
      ShowWindow $chkResetSettings ${SW_SHOW}
      ShowWindow $chkDeleteVenv ${SW_SHOW}
    ${EndIf}
    Pop $0
  FunctionEnd

  Function un.PresetFull_OnClick
    Pop $0
    Push 0
    Call un.SetCheckboxesVisible
    ${NSD_SetText} $descLabel "Standard uninstall removes the app itself, its managed python packages, and the app settings. If you have custom model paths, you will need to re-add them if you reinstall."
  FunctionEnd

  Function un.PresetCustom_OnClick
    Pop $0
    Push 1
    Call un.SetCheckboxesVisible
    ${NSD_SetText} $descLabel "Custom: Choose the specific components to remove."
  FunctionEnd

  Function un.Desc_ComfyData
    Pop $0
    ${NSD_SetText} $descLabel "Removes %APPDATA%\ComfyUI (user data)."
  FunctionEnd

  Function un.Desc_Venv
    Pop $0
    ${NSD_SetText} $descLabel "Removes base_path\.venv (Python virtual environment)."
  FunctionEnd

  Function un.Desc_UpdateCache
    Pop $0
    ${NSD_SetText} $descLabel "Removes cached installer and updater files in Local AppData."
  FunctionEnd

  Function un.Desc_ResetSettings
    Pop $0
    ${NSD_SetText} $descLabel "Removes base_path\user\default\comfy.settings.json only."
  FunctionEnd

  Function un.Desc_BasePath
    Pop $0
    ${NSD_SetText} $descLabel "Removes the entire base_path directory (use with caution)."
  FunctionEnd

  Function un.ExtraUninstallPage_Leave
    ; If Full preset selected, apply selections on leave
    ${NSD_GetState} $radioRemoveStandard $1
    ${If} $1 == 0
      ${NSD_SetState} $chkDeleteComfyUI 1
      ${NSD_SetState} $chkDeleteVenv 1
      ${NSD_SetState} $chkDeleteUpdateCache 1
      ${NSD_SetState} $chkResetSettings 0
      ${NSD_SetState} $chkDeleteBasePath 0
    ${EndIf}

    ${NSD_GetState} $chkDeleteComfyUI $0
    ${If} $0 == 1
      StrCpy $isDeleteComfyUI "1"
    ${Else}
      StrCpy $isDeleteComfyUI "0"
    ${EndIf}

    ${NSD_GetState} $chkDeleteVenv $0
    ${If} $0 == 1
      StrCpy $isDeleteVenv "1"
    ${Else}
      StrCpy $isDeleteVenv "0"
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
  FunctionEnd
!endif

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; Uninstall - Excute
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

!macro customRemoveFiles
  ${ifNot} ${isUpdated}
    ClearErrors
    FileOpen $0 "$APPDATA\ComfyUI\extra_models_config.yaml" r
    var /global line
    var /global lineLength
    var /global prefix
    var /global prefixLength
    var /global prefixFirstLetter
    var /global basePath

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
        StrCpy $basePath $2 1024 $prefixLength ; Strip off prefix

        ${if} $isDeleteBasePath == "1"
          DetailPrint "Removing base_path directory: $basePath"
          RMDir /r /REBOOTOK "$basePath"
          ${ExitDo}
        ${endIf}

        ${if} $isDeleteVenv == "1"
          StrCpy $4 "$basePath\.venv"
          DetailPrint "Removing Python virtual env: $4"
          RMDir /r /REBOOTOK "$4"
        ${endIf}

        StrCpy $5 "$basePath\uv-cache"
        DetailPrint "Removing cache directory: $5"
        RMDir /r /REBOOTOK "$5"

        ${if} $isResetSettings == "1"
          StrCpy $6 "$basePath\user\default\comfy.settings.json"
          DetailPrint "Removing user preferences: $6"
          Delete "$6"
        ${endIf}

        ${ExitDo} ; No need to continue, break the cycle
      ${EndIf}
      FileRead $0 $line
    ${LoopUntil} 1 = 0

    FileClose $0
  ${endIf}

  ${if} $isDeleteComfyUI == "1"
    StrCpy $7 "$APPDATA\ComfyUI"
    DetailPrint "Removing ComfyUI AppData: $7"
    RMDir /r /REBOOTOK "$7"
  ${endIf}

  ${if} $isDeleteUpdateCache == "1"
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}

    ; APP_INSTALLER_STORE_FILE is defined by electron-builder; it is the relative path
    ; to the copy of the installer stored under %LOCALAPPDATA% for update flows
    !ifdef APP_INSTALLER_STORE_FILE
      StrCpy $8 "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
      DetailPrint "Deleting cached installer: $8"
      Delete "$8"
    !endif

    ; APP_PACKAGE_STORE_FILE is defined when using a web/remote package; it is the
    ; cached app package stored under %LOCALAPPDATA%
    !ifdef APP_PACKAGE_STORE_FILE
      StrCpy $9 "$LOCALAPPDATA\${APP_PACKAGE_STORE_FILE}"
      DetailPrint "Deleting cached package: $9"
      Delete "$9"
    !endif

    StrCpy $R5 "$LOCALAPPDATA\@comfyorgcomfyui-electron-updater"
    DetailPrint "Removing update cache dir: $R5"
    RMDir /r /REBOOTOK "$R5"
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
