!include 'LogicLib.nsh'
!include 'TextFunc.nsh'

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

###############################################################################
#                                                                             #
#                          UNINSTALLER SECTION                                #
#                                                                             #
###############################################################################
!ifdef BUILD_UNINSTALLER
!include 'nsDialogs.nsh'

; Variables for uninstaller checkbox states
Var RemoveAppFilesCheckbox
Var RemoveAppFilesState
Var RemoveUserDataCheckbox
Var RemoveUserDataState
Var UserDataPath

; Function to extract base_path from ComfyUI config file
; Returns the path in $0, or empty string if not found
Function un.ExtractBasePath
  Push $1
  
  ; Use ConfigRead from TextFunc.nsh to read the value
  ${ConfigRead} "$APPDATA\ComfyUI\extra_models_config.yaml" "  base_path: " $0
  
  ; ConfigRead returns the value or empty string if not found
  ${If} $0 != ""
    ; Remove quotes if present
    StrCpy $1 $0 1  ; First char
    ${If} $1 == '"'
      StrCpy $1 $0 1 -1  ; Last char
      ${If} $1 == '"'
        StrLen $1 $0
        IntOp $1 $1 - 2
        StrCpy $0 $0 $1 1  ; Remove both quotes
      ${EndIf}
    ${EndIf}
  ${EndIf}
  
  Pop $1
FunctionEnd

; Add custom page after welcome page, before uninstall starts
!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.RemovalOptionsPage un.RemovalOptionsPageLeave
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
    ; Extract the base path using our unified function
    Call un.ExtractBasePath
    StrCpy $UserDataPath $0
    
    ; Handle app files removal based on checkbox
    ${If} $RemoveAppFilesState == ${BST_CHECKED}
      ; Remove configuration and cache directories
      RMDir /r "$APPDATA\ComfyUI"
      RMDir /r "$LOCALAPPDATA\@comfyorgcomfyui-electron-updater"
      RMDir /r "$LOCALAPPDATA\comfyui-electron-updater"
      
      ; Remove Python environment if it exists in user data path
      ${If} $UserDataPath != ""
        RMDir /r /REBOOTOK "$UserDataPath\.venv"
        RMDir /r /REBOOTOK "$UserDataPath\uv-cache"
      ${EndIf}
    ${Else}
      ; Keep config files for potential reinstallation
      ; Just delete the critical config files
      Delete "$APPDATA\ComfyUI\extra_models_config.yaml"
      Delete "$APPDATA\ComfyUI\config.json"
    ${EndIf}
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
  
  ; Remove the ComfyUI folder if empty (parent directory)
  ${GetParent} $INSTDIR $R0
  RMDir $R0  ; This will only remove if empty
  
  ; Remove ALL user data if checkbox was checked
  ${If} $RemoveUserDataState == ${BST_CHECKED}
    ${If} $UserDataPath != ""
      RMDir /r /REBOOTOK "$UserDataPath"
    ${EndIf}
  ${EndIf}
!macroend

; Function to create the removal options page
Function un.RemovalOptionsPage
  ; Create the dialog
  nsDialogs::Create 1018
  Pop $0
  
  ${If} $0 == error
    Abort
  ${EndIf}
  
  ; Detect the user data path using our unified function
  Call un.ExtractBasePath
  StrCpy $UserDataPath $0
  
  ; Create title text
  ${NSD_CreateLabel} 10u 5u 280u 12u "Choose what to remove:"
  Pop $0
  
  ; Create group box for removal options
  ${NSD_CreateGroupBox} 10u 20u 280u 140u "Uninstall Options"
  Pop $0
  
  ; First checkbox - Remove all app files (checked by default)
  ${NSD_CreateCheckbox} 20u 35u 260u 12u "Remove all application files and cache"
  Pop $RemoveAppFilesCheckbox
  ${NSD_Check} $RemoveAppFilesCheckbox  ; Set checked by default
  
  ; Description for app files checkbox
  ${NSD_CreateLabel} 35u 48u 245u 25u "Removes configuration, cache, and update files.$\nUncheck to preserve settings for reinstallation."
  Pop $0
  SetCtlColors $0 666666 transparent  ; Gray text for description
  
  ; Second checkbox - Remove all user data (unchecked by default)
  ${NSD_CreateCheckbox} 20u 75u 260u 12u "Remove ALL user data (models, images, workflows)"
  Pop $RemoveUserDataCheckbox
  ; Don't check by default - this is destructive
  
  ; Warning text for user data deletion
  ${If} $UserDataPath != ""
    ${NSD_CreateLabel} 35u 88u 245u 35u "WARNING: Permanently deletes:$\n$UserDataPath$\nThis cannot be undone!"
    Pop $0
    SetCtlColors $0 FF0000 transparent  ; Red text for warning
  ${Else}
    ${NSD_CreateLabel} 35u 88u 245u 20u "User data location not detected"
    Pop $0
    SetCtlColors $0 666666 transparent  ; Gray text
  ${EndIf}
  
  ; Note at the bottom
  ${NSD_CreateLabel} 10u 125u 280u 30u "The application will be uninstalled.$\nChoose whether to keep your settings and data."
  Pop $0
  
  ; Set up checkbox event handlers
  ${NSD_OnClick} $RemoveUserDataCheckbox un.OnRemoveUserDataClick
  
  nsDialogs::Show
FunctionEnd

; Handler for "Remove all user data" checkbox
Function un.OnRemoveUserDataClick
  ${NSD_GetState} $RemoveUserDataCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    ; Show warning dialog
    ${If} $UserDataPath != ""
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "WARNING: This will permanently delete ALL data in:$\n$\n$UserDataPath$\n$\nThis includes all your models, generated images, and workflows!$\n$\nThis action cannot be undone. Are you sure?" IDYES +2
      ${NSD_Uncheck} $RemoveUserDataCheckbox
    ${Else}
      MessageBox MB_OK|MB_ICONINFORMATION "User data location not detected.$\n$\nNo user data will be removed."
      ${NSD_Uncheck} $RemoveUserDataCheckbox
    ${EndIf}
  ${EndIf}
FunctionEnd

; Function called when leaving the removal options page
Function un.RemovalOptionsPageLeave
  ; Save checkbox states for use in customRemoveFiles
  ${NSD_GetState} $RemoveAppFilesCheckbox $RemoveAppFilesState
  ${NSD_GetState} $RemoveUserDataCheckbox $RemoveUserDataState
FunctionEnd

!endif ; BUILD_UNINSTALLER