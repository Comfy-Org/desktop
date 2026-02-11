!include 'MUI2.nsh'
!include 'FileFunc.nsh'
!include 'StrFunc.nsh'
!include 'LogicLib.nsh'
!include 'nsDialogs.nsh'
!include 'WinMessages.nsh'

# Register string helper functions used in installer-scope code.
${StrRep}

# Define allowToChangeInstallationDirectory to show the directory page
!define allowToChangeInstallationDirectory

Var /GLOBAL cliBasePathOverride
Var /GLOBAL cliAutoUpdateOverride
Var /GLOBAL cliPreseedConfigDir
Var /GLOBAL machineConfigPath
Var /GLOBAL machineModelConfigPath
Var /GLOBAL machineEffectiveBasePath
Var /GLOBAL cliInstallScopeOverride
Var /GLOBAL machineScopeInstallSelected

# Default to per-user install. CLI flags can override this in `ResolveInstallScopeFromCli`.
!macro customInstallMode
  StrCpy $isForceMachineInstall "0"
  StrCpy $isForceCurrentInstall "1"
  !ifdef BUILD_UNINSTALLER
    Call un.ResolveInstallScopeFromCli
  !else
    Call ResolveInstallScopeFromCli
  !endif

  StrCmp $cliInstallScopeOverride "machine" forceMachineInstall
  StrCmp $cliInstallScopeOverride "user" forceCurrentUserInstall
  Goto done

forceMachineInstall:
  StrCpy $isForceMachineInstall "1"
  StrCpy $isForceCurrentInstall "0"
  Goto done

forceCurrentUserInstall:
  StrCpy $isForceMachineInstall "0"
  StrCpy $isForceCurrentInstall "1"

done:
!macroend

!macro ResolveInstallScopeFromCliBody
  Push $0
  Push $1
  Push $2

  StrCpy $2 "0"
  StrCpy $cliInstallScopeOverride ""
  ${GetParameters} $0

  # Explicit scope controls.
  # Supported:
  #   /INSTALL_SCOPE=user|machine
  #   /ALLUSERS
  #   /CURRENTUSER
  #   /BASE_PATH=<absolute path>
  #   /AUTO_UPDATE=0|1|true|false
  #   /PRESEED_CONFIG_DIR=<absolute path>
  ClearErrors
  ${GetOptions} "$0" "/INSTALL_SCOPE=" $1
  IfErrors checkAllUsers
  StrCmp $1 "machine" setMachineFromScope
  StrCmp $1 "MACHINE" setMachineFromScope
  StrCmp $1 "user" setUserFromScope
  StrCmp $1 "USER" setUserFromScope
  DetailPrint "[Warn] Ignoring invalid /INSTALL_SCOPE value: $1"
  Goto checkAllUsers

setMachineFromScope:
  StrCpy $cliInstallScopeOverride "machine"
  StrCpy $2 "1"
  Goto checkAllUsers

setUserFromScope:
  StrCpy $cliInstallScopeOverride "user"
  StrCpy $2 "1"

checkAllUsers:
  ClearErrors
  ${GetOptions} "$0" "/ALLUSERS" $1
  IfErrors checkCurrentUser
  StrCpy $cliInstallScopeOverride "machine"
  StrCpy $2 "1"

checkCurrentUser:
  ClearErrors
  ${GetOptions} "$0" "/CURRENTUSER" $1
  IfErrors maybeOem
  StrCpy $cliInstallScopeOverride "user"
  StrCpy $2 "1"

maybeOem:
  # OEM flags default to machine mode unless explicit scope was set.
  StrCmp $2 "1" done

  ClearErrors
  ${GetOptions} "$0" "/OEM" $1
  IfErrors checkOemValue
  StrCpy $cliInstallScopeOverride "machine"
  Goto done

checkOemValue:
  ClearErrors
  ${GetOptions} "$0" "/OEM=" $1
  IfErrors done
  StrCpy $cliInstallScopeOverride "machine"

done:
  Pop $2
  Pop $1
  Pop $0
!macroend

Function ResolveInstallScopeFromCli
  !insertmacro ResolveInstallScopeFromCliBody
FunctionEnd

!ifdef BUILD_UNINSTALLER
Function un.ResolveInstallScopeFromCli
  !insertmacro ResolveInstallScopeFromCliBody
FunctionEnd
!endif

Function ResolveBasePathOverrideFromCli
  Push $0
  Push $1

  StrCpy $cliBasePathOverride ""
  ${GetParameters} $0

  ClearErrors
  ${GetOptions} "$0" "/BASE_PATH=" $1
  IfErrors checkLegacyFlag
  ${StrRep} $1 $1 '"' ""
  StrCpy $cliBasePathOverride $1
  Goto done

checkLegacyFlag:
  ClearErrors
  ${GetOptions} "$0" "/BASEPATH=" $1
  IfErrors done
  ${StrRep} $1 $1 '"' ""
  StrCpy $cliBasePathOverride $1

done:
  Pop $1
  Pop $0
FunctionEnd

Function ResolveAutoUpdateFromCli
  Push $0
  Push $1

  StrCpy $cliAutoUpdateOverride "true"
  ${GetParameters} $0

  ClearErrors
  ${GetOptions} "$0" "/AUTO_UPDATE=" $1
  IfErrors checkDisableFlag
  ${StrRep} $1 $1 '"' ""

  StrCmp $1 "1" setTrue
  StrCmp $1 "true" setTrue
  StrCmp $1 "TRUE" setTrue
  StrCmp $1 "0" setFalse
  StrCmp $1 "false" setFalse
  StrCmp $1 "FALSE" setFalse
  DetailPrint "[Warn] Ignoring invalid /AUTO_UPDATE value: $1"
  Goto checkDisableFlag

setTrue:
  StrCpy $cliAutoUpdateOverride "true"
  Goto done

setFalse:
  StrCpy $cliAutoUpdateOverride "false"
  Goto done

checkDisableFlag:
  ClearErrors
  ${GetOptions} "$0" "/DISABLE_AUTO_UPDATE" $1
  IfErrors done
  StrCpy $cliAutoUpdateOverride "false"

done:
  Pop $1
  Pop $0
FunctionEnd

Function ResolvePreseedConfigDirFromCli
  Push $0
  Push $1

  StrCpy $cliPreseedConfigDir ""
  ${GetParameters} $0

  ClearErrors
  ${GetOptions} "$0" "/PRESEED_CONFIG_DIR=" $1
  IfErrors checkLegacyPreseedFlag
  ${StrRep} $1 $1 '"' ""
  StrCpy $cliPreseedConfigDir $1
  Goto done

checkLegacyPreseedFlag:
  ClearErrors
  ${GetOptions} "$0" "/PRESEED=" $1
  IfErrors done
  ${StrRep} $1 $1 '"' ""
  StrCpy $cliPreseedConfigDir $1

done:
  Pop $1
  Pop $0
FunctionEnd

Function PersistMachineScopeInstallerOverrides
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4

  ${If} $machineScopeInstallSelected != "1"
    Goto done
  ${EndIf}

  # Resolve ProgramData root and machine default base path for all machine installs.
  # ACL hardening uses this even when no explicit OEM overrides were passed.
  ReadEnvStr $0 "ProgramData"
  ${If} $0 == ""
    StrCpy $0 "C:\ProgramData"
  ${EndIf}

  StrCpy $machineEffectiveBasePath "$0\ComfyUI\base"
  ${If} $cliBasePathOverride != ""
    StrCpy $machineEffectiveBasePath $cliBasePathOverride
  ${EndIf}

  ${If} $cliBasePathOverride == ""
    StrCpy $cliBasePathOverride $machineEffectiveBasePath
  ${EndIf}

  StrCpy $machineConfigPath "$0\ComfyUI\machine-config.json"
  StrCpy $machineModelConfigPath "$0\ComfyUI\extra_models_config.yaml"
  CreateDirectory "$0\ComfyUI"

  StrCpy $1 $cliBasePathOverride
  ${StrRep} $1 $1 "\" "\\"
  StrCpy $2 $machineModelConfigPath
  ${StrRep} $2 $2 "\" "\\"
  StrCpy $4 $cliPreseedConfigDir
  ${StrRep} $4 $4 "\" "\\"

  ClearErrors
  FileOpen $3 "$machineConfigPath" w
  IfErrors writeFailed

  FileWrite $3 "{$\r$\n"
  FileWrite $3 "  $\"version$\": 1,$\r$\n"
  FileWrite $3 "  $\"installState$\": $\"started$\",$\r$\n"
  FileWrite $3 "  $\"basePath$\": $\"$1$\",$\r$\n"
  FileWrite $3 "  $\"modelConfigPath$\": $\"$2$\",$\r$\n"
  FileWrite $3 "  $\"autoUpdate$\": $cliAutoUpdateOverride,$\r$\n"
  ${If} $cliPreseedConfigDir != ""
    FileWrite $3 "  $\"preseedConfigDir$\": $\"$4$\",$\r$\n"
  ${EndIf}
  FileWrite $3 "  $\"updatedAt$\": $\"1970-01-01T00:00:00.000Z$\"$\r$\n"
  FileWrite $3 "}$\r$\n"
  FileClose $3

  DetailPrint "[OEM] Saved machine base path: $cliBasePathOverride"
  DetailPrint "[OEM] Saved machine auto-update setting: $cliAutoUpdateOverride"
  ${If} $cliPreseedConfigDir != ""
    DetailPrint "[OEM] Saved machine preseed config dir: $cliPreseedConfigDir"
  ${EndIf}
  DetailPrint "[OEM] Machine config file: $machineConfigPath"
  Goto done

writeFailed:
  DetailPrint "[Warn] Could not write machine config file for machine-scope install: $machineConfigPath"

done:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function HardenMachineScopeDataAcl
  Push $0
  Push $1

  ${If} $machineScopeInstallSelected != "1"
    Goto done
  ${EndIf}

  StrCpy $0 $machineEffectiveBasePath
  ${If} $0 == ""
    Goto done
  ${EndIf}

  CreateDirectory "$0"
  DetailPrint "[OEM] Hardening ACLs for machine base path: $0"

  # Use SID-based grants for locale-independent behavior:
  #  - SYSTEM (S-1-5-18): Full control
  #  - BUILTIN\Administrators (S-1-5-32-544): Full control
  #  - BUILTIN\Users (S-1-5-32-545): Modify
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$0" /inheritance:e /grant *S-1-5-18:(OI)(CI)F /grant *S-1-5-32-544:(OI)(CI)F /grant *S-1-5-32-545:(OI)(CI)M /T /C'
  Pop $1
  ${If} $1 != "0"
    DetailPrint "[Warn] icacls returned non-zero exit code for base path ACL hardening: $1"
  ${EndIf}

done:
  Pop $1
  Pop $0
FunctionEnd

!macro customInstall
  StrCpy $machineScopeInstallSelected "0"
  ${if} $installMode == "all"
    StrCpy $machineScopeInstallSelected "1"
  ${endif}
  Call ResolveBasePathOverrideFromCli
  Call ResolveAutoUpdateFromCli
  Call ResolvePreseedConfigDirFromCli
  Call PersistMachineScopeInstallerOverrides
  Call HardenMachineScopeDataAcl
!macroend

# Custom finish page that skips when in update mode
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif

  !define MUI_PAGE_CUSTOMFUNCTION_PRE FinishPagePreCheck
  !insertmacro MUI_PAGE_FINISH

  # Skip finish page during updates
  Function FinishPagePreCheck
    ${if} ${isUpdated}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
      Abort
    ${endif}
  FunctionEnd
!macroend

!ifdef BUILD_UNINSTALLER
  # Default to showing details in uninstaller InstFiles page
  ShowUninstDetails show
!endif

# Utility: Capture current NSIS reboot flag into a variable ("0" or "1")
!macro GET_REBOOTFLAG_TO_VAR _outVar
  !define _LBL_SET "rf_set_${__LINE__}"
  !define _LBL_DONE "rf_done_${__LINE__}"

  StrCpy ${_outVar} "0"
  IfRebootFlag ${_LBL_SET}
  Goto ${_LBL_DONE}
  ${_LBL_SET}:
    StrCpy ${_outVar} "1"
  ${_LBL_DONE}:

  !undef _LBL_SET
  !undef _LBL_DONE
!macroend

# Wrapper: RMDir with logging + reboot detection (prints to details)
# Usage: !insertmacro RMDIR_LOGGED "<path>" "<friendly label>"
!macro RMDIR_LOGGED _path _description
  Push $0
  Push $1
  Push $2
  Push $3

  # Capture previous reboot flag state
  !insertmacro GET_REBOOTFLAG_TO_VAR $0

  # Reset flag to detect if this call sets it (schedule-on-reboot)
  DetailPrint "Removing ${_description}: ${_path}"
  SetRebootFlag false
  ClearErrors
  RMDir /r /REBOOTOK "${_path}"

  ${If} ${Errors}
    DetailPrint "[Error] Failed to remove ${_description}: ${_path}"
  ${Else}
    !insertmacro GET_REBOOTFLAG_TO_VAR $2
    ${If} $2 == "1"
      DetailPrint "[Reboot] Scheduled removal of ${_description}: ${_path}"
    ${Else}
      DetailPrint "[OK] Removed ${_description}: ${_path}"
    ${EndIf}
  ${EndIf}

  # Restore reboot flag to (prev OR new)
  ${If} $0 == "1"
  ${OrIf} $2 == "1"
    SetRebootFlag true
  ${EndIf}

  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

# Centralized strings, to be converted to i18n when practical
!define TITLE_CHOOSE         "Choose what to remove"
!define DESC_STANDARD        "Standard uninstall removes the app itself, its managed python packages, and some settings only for the desktop app. It does not remove model files or content that was created."
!define DESC_CUSTOM          "Custom allows you to select which components to uninstall. The detected install path is:"
!define LABEL_STANDARD       "Standard"
!define LABEL_CUSTOM         "Custom"
!define LABEL_APPDATA        "Delete logs and Desktop settings"
!define LABEL_VENV           "Remove the ComfyUI Python virtual environment (.venv)"
!define LABEL_UPDATECACHE    "Remove any temporary update files"
!define LABEL_RESETSETTINGS  "Reset ComfyUI settings (comfy.settings.json)"
!define LABEL_BASEPATH       "Completely delete ComfyUI Path - all models, created content, etc"
!define LABEL_COMFYUI_PATH   "ComfyUI Path"
!define LABEL_NOT_FOUND      "Not found"
!define LABEL_CONFIRM_DELETE "Yes, delete the ComfyUI Folder"

# The following is used to add the "/SD" flag to MessageBox so that the
# machine can restart if the uninstaller fails.
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

################################################################################
# Uninstall - Config / Functions
################################################################################

# Resolve basePath at uninstaller startup
!macro customUnInit
  Call un.ResolveBasePath
!macroend

# Insert custom pages: options, then conditional confirmation
!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.ExtraUninstallPage_Create un.ExtraUninstallPage_Leave
  UninstPage custom un.ConfirmDeleteBasePath_Create un.ConfirmDeleteBasePath_Leave
!macroend

!ifdef BUILD_UNINSTALLER
  ${UnStrRep}

  Var /GLOBAL basePath

  Var /GLOBAL descLabel
  Var /GLOBAL basePathLabel

  Var /GLOBAL radioRemoveStandard
  Var /GLOBAL radioRemoveCustom

  Var /GLOBAL isDeleteComfyUI
  Var /GLOBAL chkDeleteComfyUI
  Var /GLOBAL isDeleteBasePath
  Var /GLOBAL chkDeleteBasePath
  Var /GLOBAL isDeleteUpdateCache
  Var /GLOBAL chkDeleteUpdateCache
  Var /GLOBAL isResetSettings
  Var /GLOBAL chkResetSettings
  Var /GLOBAL isDeleteVenv
  Var /GLOBAL chkDeleteVenv
  Var /GLOBAL confirmCheckbox

  # Create uninstall options page
  Function un.ExtraUninstallPage_Create
    !insertmacro MUI_HEADER_TEXT "${TITLE_CHOOSE}" ""

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    # Description label (default Standard)
    ${NSD_CreateLabel} 0 0 100% 24u "${DESC_STANDARD}"
    Pop $descLabel

    ${NSD_CreateRadioButton} 0 24u 100% 12u "${LABEL_STANDARD}"
    Pop $radioRemoveStandard
    ${NSD_CreateRadioButton} 0 40u 100% 12u "${LABEL_CUSTOM}"
    Pop $radioRemoveCustom
    ${NSD_SetState} $radioRemoveStandard 1
    ${NSD_OnClick} $radioRemoveStandard un.PresetFull_OnClick
    ${NSD_OnClick} $radioRemoveCustom un.PresetCustom_OnClick

    ${NSD_CreateCheckBox} 8u 54u 100% 12u "${LABEL_APPDATA}"
    Pop $chkDeleteComfyUI
    StrCpy $isDeleteComfyUI "1"
    ${NSD_SetState} $chkDeleteComfyUI 1
    ${NSD_OnClick} $chkDeleteComfyUI un.Desc_ComfyData

    ${NSD_CreateCheckBox} 8u 68u 100% 12u "${LABEL_UPDATECACHE}"
    Pop $chkDeleteUpdateCache
    StrCpy $isDeleteUpdateCache "1"
    ${NSD_SetState} $chkDeleteUpdateCache 1
    ${NSD_OnClick} $chkDeleteUpdateCache un.Desc_UpdateCache

    ${NSD_CreateCheckBox} 8u 82u 100% 12u "${LABEL_VENV}"
    Pop $chkDeleteVenv
    StrCpy $isDeleteVenv "1"
    ${NSD_SetState} $chkDeleteVenv 1
    ${NSD_OnClick} $chkDeleteVenv un.Desc_Venv

    ${NSD_CreateCheckBox} 8u 96u 100% 12u "${LABEL_RESETSETTINGS}"
    Pop $chkResetSettings
    StrCpy $isResetSettings "0"
    ${NSD_SetState} $chkResetSettings 0
    ${NSD_OnClick} $chkResetSettings un.Desc_ResetSettings

    ${NSD_CreateCheckBox} 8u 110u 100% 12u "${LABEL_BASEPATH}"
    Pop $chkDeleteBasePath
    StrCpy $isDeleteBasePath "0"
    ${NSD_SetState} $chkDeleteBasePath 0
    ${NSD_OnClick} $chkDeleteBasePath un.Desc_BasePath

    # ComfyUI Path
    ${If} $basePath != ""
      StrCpy $1 "${LABEL_COMFYUI_PATH}: $basePath"
    ${Else}
      StrCpy $1 "${LABEL_COMFYUI_PATH}: ${LABEL_NOT_FOUND}"
    ${EndIf}

    ${NSD_CreateLabel} 0 126u 100% 12u "$1"
    Pop $basePathLabel

    # Disable checkboxes if basePath is not found
    ${If} $basePath == ""
      EnableWindow $chkResetSettings 0
      EnableWindow $chkDeleteVenv 0
      EnableWindow $chkDeleteBasePath 0
      ${NSD_SetState} $chkResetSettings 0
      ${NSD_SetState} $chkDeleteVenv 0
      ${NSD_SetState} $chkDeleteBasePath 0
    ${EndIf}

    # Hide all checkboxes by default (shown when Custom is selected)
    Push 0
    Call un.SetCheckboxesVisible

    nsDialogs::Show
  FunctionEnd

  Function un.SetCheckboxesVisible
    Exch $0
    ${If} $0 == 0
      ShowWindow $chkDeleteComfyUI ${SW_HIDE}
      ShowWindow $chkDeleteUpdateCache ${SW_HIDE}
      ShowWindow $chkResetSettings ${SW_HIDE}
      ShowWindow $chkDeleteVenv ${SW_HIDE}
      ShowWindow $chkDeleteBasePath ${SW_HIDE}
    ${Else}
      ShowWindow $chkDeleteComfyUI ${SW_SHOW}
      ShowWindow $chkDeleteUpdateCache ${SW_SHOW}
      ${If} $basePath != ""
        ShowWindow $chkResetSettings ${SW_SHOW}
        ShowWindow $chkDeleteVenv ${SW_SHOW}
        ShowWindow $chkDeleteBasePath ${SW_SHOW}
      ${EndIf}
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
    ${NSD_SetText} $descLabel "Removes %APPDATA%\ComfyUI (log files, settings exclusive to the desktop app)."
  FunctionEnd

  Function un.Desc_Venv
    Pop $0
    ${NSD_SetText} $descLabel "Removes the Python virtual environment (.venv) used by the desktop app."
  FunctionEnd

  Function un.Desc_UpdateCache
    Pop $0
    ${NSD_SetText} $descLabel "Removes cached installer and updater files in Local AppData."
  FunctionEnd

  Function un.Desc_ResetSettings
    Pop $0
    ${NSD_SetText} $descLabel "Removes the ComfyUI settings file (comfy.settings.json), resetting in-app settings."
  FunctionEnd

  Function un.Desc_BasePath
    Pop $0
    ${NSD_SetText} $descLabel "Removes the entire ComfyUI Path directory (use with caution)."
  FunctionEnd

  Function un.ExtraUninstallPage_Leave
    # If Full preset selected, apply selections on leave
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
  
  # Confirmation page after options (only shown if base_path is selected)
  Function un.ConfirmDeleteBasePath_Create
    ${IfNot} $isDeleteBasePath == "1"
      Abort
    ${EndIf}
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    # Warning title
    ${NSD_CreateLabel} 0 0 100% 24u "Are you sure?"
    Pop $1
    # Create bold 16pt font and apply to first label
    System::Call 'gdi32::CreateFont(i -16, i 0, i 0, i 0, i 700, i 0, i 0, i 0, i 0, i 0, i 0, i 0, t "MS Shell Dlg") p .r9'
    SendMessage $1 ${WM_SETFONT} $9 1

    ${NSD_CreateLabel} 0 24u 100% 24u "This will PERMANENTLY delete the folder below. It is used to store models, LoRAs inputs, outputs, and other data."
    ${NSD_CreateLabel} 0 48u 100% 24u "$basePath"
    Pop $2
    # Create bold 10pt font and apply to first label
    System::Call 'gdi32::CreateFont(i -12, i 0, i 0, i 0, i 700, i 0, i 0, i 0, i 0, i 0, i 0, i 0, t "MS Shell Dlg") p .r9'
    SendMessage $2 ${WM_SETFONT} $9 1

    ${NSD_CreateCheckBox} 0 72u 100% 12u "${LABEL_CONFIRM_DELETE}"
    Pop $confirmCheckbox

    nsDialogs::Show
  FunctionEnd

  Function un.ConfirmDeleteBasePath_Leave
    ${NSD_GetState} $confirmCheckbox $0
    ${IfNot} $0 == 1
      StrCpy $isDeleteBasePath "0"
    ${EndIf}
  FunctionEnd

  Function un.ReadBasePathFromJsonFile
    Pop $0
    ClearErrors
    FileOpen $1 "$0" r
    IfErrors done

    StrCpy $2 "basePath"
    StrLen $3 $2

    loop:
      FileRead $1 $4
      IfErrors close

      # scan for "basePath"
      StrCpy $R2 -1
      scan:
        IntOp $R2 $R2 + 1
        StrCpy $R3 $4 1 $R2
        StrCmp $R3 "" loop
        StrCmp $R3 '"' check_key
        Goto scan

      check_key:
        IntOp $R4 $R2 + 1
        StrCpy $R5 $4 $3 $R4
        StrCmp $R5 $2 next_quote scan

      next_quote:
        IntOp $R6 $R4 + $3
        StrCpy $R7 $4 1 $R6
        StrCmp $R7 '"' find_colon scan

      find_colon:
        IntOp $R8 $R6 + 1
        find_colon_loop:
          StrCpy $R7 $4 1 $R8
          StrCmp $R7 ":" after_colon
          StrCmp $R7 "" loop
          IntOp $R8 $R8 + 1
          Goto find_colon_loop

      after_colon:
        IntOp $R9 $R8 + 1
        find_open_quote:
          StrCpy $R7 $4 1 $R9
          StrCmp $R7 '"' open_ok
          StrCmp $R7 "" loop
          IntOp $R9 $R9 + 1
          Goto find_open_quote

      open_ok:
        IntOp $R0 $R9 + 1
        find_close_quote:
          StrCpy $R7 $4 1 $R0
          StrCmp $R7 '"' got_value
          StrCmp $R7 "" loop
          IntOp $R0 $R0 + 1
          Goto find_close_quote

      got_value:
        IntOp $R1 $R0 - $R9
        IntOp $R1 $R1 - 1
        IntOp $R6 $R9 + 1
        StrCpy $basePath $4 $R1 $R6
        # Normalize JSON doubled backslashes to single backslashes
        ${UnStrRep} $basePath $basePath "\\" "\"
        Goto close

    close:
      FileClose $1
    done:
  FunctionEnd

  # Resolve $basePath by preferring the machine config override before falling back to the per-user settings
  Function un.ResolveBasePath
    StrCpy $basePath ""

    ReadEnvStr $0 "ProgramData"
    ${If} $0 == ""
      StrCpy $0 "C:\ProgramData"
    ${EndIf}

    StrCpy $R1 "$0\ComfyUI\machine-config.json"
    Push $R1
    Call un.ReadBasePathFromJsonFile

    ${If} $basePath == ""
      StrCpy $R1 "$APPDATA\ComfyUI\config.json"
      Push $R1
      Call un.ReadBasePathFromJsonFile
    ${EndIf}
  FunctionEnd
!endif

################################################################################
# Uninstall - Excute
################################################################################

!macro customRemoveFiles
  ${if} ${isUpdated}
  ${else}
    # Manually uninstalling the app
    Call un.ResolveBasePath

    ${if} $basePath != ""
      ${if} $isDeleteBasePath == "1"
        !insertmacro RMDIR_LOGGED "$basePath" "ComfyUI data path (models, output, etc)"
      ${else}
        ${if} $isDeleteVenv == "1"
          StrCpy $4 "$basePath\.venv"
          !insertmacro RMDIR_LOGGED "$4" "Python virtual environment"
        ${endIf}

        StrCpy $5 "$basePath\uv-cache"
        !insertmacro RMDIR_LOGGED "$5" "Legacy package cache"

        ${if} $isResetSettings == "1"
          StrCpy $6 "$basePath\user\default\comfy.settings.json"
          DetailPrint "Removing user preferences: $6"
          Delete "$6"
        ${endIf}
      ${endIf}
    ${endIf}

    ${if} $isDeleteComfyUI == "1"
      # Use built-in electron-builder app data removal
      !define DELETE_APP_DATA_ON_UNINSTALL "1"
    ${endIf}

    ${if} $isDeleteUpdateCache == "1"
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}

      StrCpy $R5 "$LOCALAPPDATA\@comfyorgcomfyui-electron-updater"
      !insertmacro RMDIR_LOGGED "$R5" "Updater cache"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    ${endIf}

    # Attempt to remove install dir if empty
    ClearErrors
    RMDir $INSTDIR
    IfErrors +3 0
    DetailPrint "Removed install dir: $INSTDIR"
    Goto +2
    DetailPrint "Install dir not empty; leaving in place."
  ${endIf}
!macroend
