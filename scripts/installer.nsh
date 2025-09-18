!include 'LogicLib.nsh'
!include 'nsDialogs.nsh'

; Centralized strings, to be converted to i18n when practical
!define TITLE_CHOOSE        "Choose what to remove"
!define DESC_STANDARD       "Standard uninstall removes the app itself, its managed python packages, and some settings only for the desktop app. It does not remove model files or content that was created."
!define DESC_CUSTOM         "Custom allows you to select which components to uninstall. The detected install path is:"
!define LABEL_STANDARD      "Standard"
!define LABEL_CUSTOM        "Custom"
!define LABEL_APPDATA       "Delete logs and Desktop settings"
!define LABEL_VENV          "Remove the ComfyUI Python virtual environment (.venv)"
!define LABEL_UPDATECACHE   "Remove any temporary update files"
!define LABEL_RESETSETTINGS "Reset ComfyUI settings (comfy.settings.json)"
!define LABEL_BASEPATH      "Remove all models / created content from"

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
  Var /GLOBAL basePath

  ; Resolve basePath at uninstaller startup
  !macro customUnInit
    Call un.ResolveBasePath
  !macroend

  ; Insert a custom page right after the Uninstall Welcome page
  !macro customUnWelcomePage
    ; Keep the default welcome screen
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.ExtraUninstallPage_Create un.ExtraUninstallPage_Leave
  !macroend

  Function un.ExtraUninstallPage_Create
    !insertmacro MUI_HEADER_TEXT "${TITLE_CHOOSE}" ""

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ; Description label (default Standard)
    ${NSD_CreateLabel} 0 0 100% 24u "${DESC_STANDARD}"
    Pop $descLabel

    ${NSD_CreateRadioButton} 0 24u 100% 12u "${LABEL_STANDARD}"
    Pop $radioRemoveStandard
    ${NSD_CreateRadioButton} 0 40u 100% 12u "${LABEL_CUSTOM}"
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

    ; If basePath is known, append specifics to labels
    ${If} $basePath != ""
      StrCpy $4 "$basePath\.venv"
      ${NSD_SetText} $chkDeleteVenv "${LABEL_VENV} ($4)"
      ${NSD_SetText} $chkDeleteBasePath "${LABEL_BASEPATH} [$basePath]"
    ${EndIf}

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
    ${NSD_SetText} $descLabel "${DESC_STANDARD}"
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
    ${If} $1 == 1
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

  ; Resolve $basePath from $APPDATA\ComfyUI\extra_models_config.yaml (sets empty if not found)
  Function un.ResolveBasePath
    StrCpy $basePath ""
    ClearErrors
    FileOpen $0 "$APPDATA\ComfyUI\extra_models_config.yaml" r
    IfErrors done

    StrCpy $1 "base_path:"        ; prefix without trailing space for robustness
    StrLen $2 $1                   ; $2 = prefix length

    loop:
      FileRead $0 $3
      IfErrors close

      ; Trim leading spaces/tabs
      StrCpy $4 -1
      nextc:
        IntOp $4 $4 + 1
        StrCpy $5 $3 1 $4
        StrCmp $5 " " nextc
        StrCmp $5 "\t" nextc

      ; Compare prefix at first non-space
      StrCpy $6 $3 $2 $4
      StrCmp $6 $1 0 loop

      ; Extract value after 'base_path:' (skip optional space)
      IntOp $7 $4 + $2
      StrCpy $5 $3 1 $7
      StrCmp $5 " " 0 +2
        IntOp $7 $7 + 1
      StrCpy $basePath $3 1024 $7
      Goto close

    close:
      FileClose $0
    done:
  FunctionEnd
!endif

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; Uninstall - Excute
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

!macro customRemoveFiles
  ${ifNot} ${isUpdated}
    Call un.ResolveBasePath

    ${if} $basePath != ""
      ${if} $isDeleteBasePath == "1"
        DetailPrint "Removing base_path directory: $basePath"
        RMDir /r /REBOOTOK "$basePath"
      ${else}
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
      ${endIf}
    ${endIf}
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
