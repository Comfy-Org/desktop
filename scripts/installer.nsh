!include 'LogicLib.nsh'

; Include uninstaller-specific code
!ifdef BUILD_UNINSTALLER
  !include "${BUILD_RESOURCES_DIR}\..\scripts\uninstaller.nsh"
!endif

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
