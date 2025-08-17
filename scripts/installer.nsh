!include 'LogicLib.nsh'
!include 'nsDialogs.nsh'
!include 'MUI2.nsh'

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

; Global variable to track if VC++ needs to be installed
Var /GLOBAL needsVCRedist
!endif

; This macro is called AFTER the template (oneClick.nsh) is loaded but BEFORE compilation
; We use it to transform the oneClick installer into a full assisted installer
!macro customHeader
  ; Only modify if ONE_CLICK env var is set
  !ifdef ONE_CLICK
    ; Define the flag that enables directory selection
    !define allowToChangeInstallationDirectory

    ; Include helper for directory sanitization
    !include StrContains.nsh

    ; Add Welcome page
    !insertmacro MUI_PAGE_WELCOME

    ; Add Directory Selection page
    !insertmacro MUI_PAGE_DIRECTORY

    ; The MUI_PAGE_INSTFILES from oneClick.nsh will be here in the page order

    ; Add Finish page with Run option
    !ifndef HIDE_RUN_AFTER_FINISH
      !define MUI_FINISHPAGE_RUN
      !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
    !endif
    !insertmacro MUI_PAGE_FINISH
  !endif
!macroend

; Function to sanitize the installation directory
; Ensures it includes the application name as a subfolder
!ifdef ONE_CLICK
Function instFilesPre
    ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
    ${If} $0 == ""
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${EndIf}
FunctionEnd

; Function to start the application after installation
!ifndef BUILD_UNINSTALLER
Function StartApp
    ${if} ${isUpdated}
        StrCpy $1 "--updated"
    ${else}
        StrCpy $1 ""
    ${endif}

    ; Use the launch link if available, otherwise use the exe directly
    ${If} ${FileExists} "$newStartMenuLink"
        StrCpy $launchLink "$newStartMenuLink"
    ${Else}
        StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${EndIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
FunctionEnd
!endif
!endif

; Custom initialization macro - runs early in the installation process
!macro customInit
    ; Save register state
    Push $0
    Push $1
    Push $2

    ; Set default installation directory if not already set
    ${If} $INSTDIR == ""
        ; Try to use Program Files for default location
        StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCT_NAME}"
    ${EndIf}

    ; Check if VC++ Runtime is already installed
    Call checkVCRedist

    ; Store result for later use in customInstall
    ${If} $0 != 1
        StrCpy $needsVCRedist "1"
    ${Else}
        StrCpy $needsVCRedist "0"
    ${EndIf}

    ; Restore register state
    Pop $2
    Pop $1
    Pop $0
!macroend

; Custom install macro - runs during the main installation phase
; Installs VC++ Redistributable if needed
!macro customInstall
    ${If} $needsVCRedist == "1"
        ; Install VC++ during main installation process
        DetailPrint "Installing Microsoft Visual C++ 2015-2022 Redistributable (x64)..."

        ; Extract bundled VC++ redistributable to temp directory
        File /oname=$TEMP\vc_redist.x64.exe "${BUILD_RESOURCES_DIR}\vcredist\vc_redist.x64.exe"

        ; Install silently
        DetailPrint "Please wait, installing prerequisites..."
        ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart' $0

        ; Check installation result
        ${If} $0 == 0
            DetailPrint "Visual C++ Redistributable installed successfully."
        ${Else}
            DetailPrint "Warning: Visual C++ Redistributable installation returned code $0"
            ; Don't show a popup - just log the warning
            ; The app might still work, and we don't want to interrupt the installation
        ${EndIf}

        ; Clean up
        Delete "$TEMP\vc_redist.x64.exe"

        ; Verify installation succeeded
        Call checkVCRedist
        ${If} $0 != 1
            DetailPrint "Note: Visual C++ Redistributable may need to be installed manually from:"
            DetailPrint "https://aka.ms/vs/17/release/vc_redist.x64.exe"
        ${EndIf}
    ${EndIf}
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

        ${ExitDo} ; No need to continue, break the cycle
      ${EndIf}
      FileRead $0 $line
    ${LoopUntil} 1 = 0

    FileClose $0
    Delete "$APPDATA\ComfyUI\extra_models_config.yaml"
    Delete "$APPDATA\ComfyUI\config.json"
  ${endIf}
!macroend