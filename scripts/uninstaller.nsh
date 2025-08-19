!include 'LogicLib.nsh'
!include 'nsDialogs.nsh'

; Variables for uninstaller checkbox states
Var DeleteVenvCheckbox
Var DeleteVenvState

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

!macro customRemoveFiles
  ; First perform custom ComfyUI cleanup
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
        ; Only delete .venv and cache if checkbox was checked
        ${If} $DeleteVenvState == ${BST_CHECKED}
          RMDir /r /REBOOTOK "$3\.venv"
          RMDir /r /REBOOTOK "$3\uv-cache"
        ${EndIf}

        ${ExitDo} ; No need to continue, break the cycle
      ${EndIf}
      FileRead $0 $line
    ${LoopUntil} 1 = 0

    FileClose $0
    Delete "$APPDATA\ComfyUI\extra_models_config.yaml"
    Delete "$APPDATA\ComfyUI\config.json"
  ${endIf}

  ; Now perform the default electron-builder uninstall logic
  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"

    Push ""
    Call un.atomicRMDir
    Pop $R0

    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"

      ; Attempt to restore previous directory
      Push ""
      Call un.restoreFiles
      Pop $R0

      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${endif}
  ${endif}

  ; Remove all files (or remaining shallow directories from the block above)
  RMDir /r $INSTDIR
!macroend

; Custom uninstaller page with checkbox options
!macro customUninstallPage
  Page custom un.RemovalOptionsPage un.RemovalOptionsPageLeave
!macroend

; Function to create the removal options page
Function un.RemovalOptionsPage
  ; Create the dialog
  nsDialogs::Create 1018
  Pop $0
  
  ${If} $0 == error
    Abort
  ${EndIf}
  
  ; Create title text
  ${NSD_CreateLabel} 10u 5u 280u 12u "Choose which components to remove:"
  Pop $0
  
  ; Create group box for removal options
  ${NSD_CreateGroupBox} 10u 20u 280u 80u "Remove"
  Pop $0
  
  ; Create checkbox for .venv removal (checked by default)
  ${NSD_CreateCheckbox} 20u 35u 260u 12u "Virtual environment (.venv) - Recommended"
  Pop $DeleteVenvCheckbox
  ${NSD_Check} $DeleteVenvCheckbox  ; Set checked by default
  
  ; Additional info text
  ${NSD_CreateLabel} 20u 50u 260u 20u "Removes Python virtual environment and deprecated uv-cache directory.$\nRecommended."
  Pop $0
  
  ; Note at the bottom
  ${NSD_CreateLabel} 10u 105u 280u 20u "Application files and settings will always be removed."
  Pop $0
  
  nsDialogs::Show
FunctionEnd

; Function called when leaving the removal options page
Function un.RemovalOptionsPageLeave
  ; Save the checkbox state for use in customRemoveFiles
  ${NSD_GetState} $DeleteVenvCheckbox $DeleteVenvState
FunctionEnd
