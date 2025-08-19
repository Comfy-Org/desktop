!include 'LogicLib.nsh'
!include 'nsDialogs.nsh'

; Variables for uninstaller checkbox states
Var DeleteVenvCheckbox
Var DeleteVenvState

; Function to check if VC++ Runtime is installed
!ifndef BUILD_UNINSTALLER
Function checkVCRedist
    ; Check primary registry location for x64 runtime
    ClearErrors
    SetRegView 64
    ReadRegDWORD $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    SetRegView 32

    ; Return 1 if installed, 0 if not
    ${If} ${Errors}
        StrCpy $0 0
    ${EndIf}
FunctionEnd

; Function to verify VC++ installation and show appropriate message
Function verifyVCRedistInstallation
    Call checkVCRedist
    ${If} $0 == 1
        DetailPrint "Visual C++ Redistributable installed successfully."
    ${Else}
        ; Installation may have failed or was cancelled
        MessageBox MB_OK|MB_ICONEXCLAMATION \
            "Visual C++ Redistributable installation could not be verified.$\r$\n$\r$\n\
            ComfyUI Desktop installation will continue, but some features may not work correctly.$\r$\n$\r$\n\
            You may need to install Visual C++ Redistributable manually from Microsoft's website."
        DetailPrint "Warning: Visual C++ Redistributable installation could not be verified."
    ${EndIf}
FunctionEnd
!endif

; Custom initialization macro - runs early in the installation process
!macro customInit
    ; Save register state
    Push $0
    Push $1
    Push $2

    ; Check if VC++ Runtime is already installed
    Call checkVCRedist

    ${If} $0 != 1
        ; Not installed - ask user if they want to install it
        MessageBox MB_YESNO|MB_ICONINFORMATION \
            "ComfyUI Desktop requires Microsoft Visual C++ 2015-2022 Redistributable (x64) to function properly.$\r$\n$\r$\n\
            This component is not currently installed on your system.$\r$\n$\r$\n\
            Would you like to install it now?$\r$\n$\r$\n\
            Note: If you choose No, some features may not work correctly." \
            /SD IDYES IDYES InstallVCRedist IDNO SkipVCRedist

        InstallVCRedist:
            ; Show progress message
            Banner::show /NOUNLOAD "Installing Visual C++ Redistributable..."

            ; Extract bundled VC++ redistributable to temp directory
            DetailPrint "Extracting Microsoft Visual C++ Redistributable..."

            ; Copy bundled redistributable from assets to temp
            File /oname=$TEMP\vc_redist.x64.exe "${BUILD_RESOURCES_DIR}\vcredist\vc_redist.x64.exe"

            ; Install it
            DetailPrint "Installing Microsoft Visual C++ Redistributable..."
            DetailPrint "Please wait, this may take a minute..."

            ; Use ExecShellWait to handle UAC properly AND wait for completion
            ; This combines the benefits of ExecShell (proper UAC) with waiting
            DetailPrint "Waiting for Visual C++ Redistributable installation to complete..."
            
            ; ExecShellWait with "runas" verb for explicit UAC elevation
            ExecShellWait "runas" "$TEMP\vc_redist.x64.exe" "/install /quiet /norestart" SW_SHOWNORMAL

            ; Hide progress message
            Banner::destroy

            ; Verify installation succeeded
            Call verifyVCRedistInstallation

            ; Clean up downloaded file
            Delete "$TEMP\vc_redist.x64.exe"
            Goto ContinueInstall

        SkipVCRedist:
            ; User chose to skip - warn them
            MessageBox MB_OK|MB_ICONEXCLAMATION \
                "Visual C++ Redistributable will not be installed.$\r$\n$\r$\n\
                Warning: ComfyUI Desktop may not function correctly without this component.$\r$\n$\r$\n\
                You can download it manually from:$\r$\n\
                https://aka.ms/vs/17/release/vc_redist.x64.exe"
    ${EndIf}

    ContinueInstall:
    ; Restore register state
    Pop $2
    Pop $1
    Pop $0
!macroend

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
!ifdef BUILD_UNINSTALLER
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
!endif
