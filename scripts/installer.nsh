!include 'LogicLib.nsh'

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
    ; Ask user about complete removal
    MessageBox MB_YESNO|MB_ICONQUESTION "Do you want to completely remove all ComfyUI data?$\n$\nSelect 'Yes' to remove all settings, models, and cache (complete removal).$\nSelect 'No' to keep user data and models (standard removal).\n\nWARNING: THIS REMOVES ALL DATA, GENERATED IMAGES OR OTHER CONTENT, AND MODELS." /SD IDNO IDYES CompleteRemoval IDNO StandardRemoval
    
    CompleteRemoval:
      ; Complete removal - delete everything
      DetailPrint "Performing complete removal of all ComfyUI data..."
      
      ; Remove main ComfyUI data directory
      RMDir /r /REBOOTOK "$APPDATA\ComfyUI"
      
      ; Remove updater directory
      RMDir /r /REBOOTOK "$LOCALAPPDATA\@comfyorg\comfyui-electron-updater"
      
      ; Remove program directory (if not the current installation directory)
      RMDir /r /REBOOTOK "$LOCALAPPDATA\Programs\@comfyorg\comfyui-electron"
      
      ; Clean up any remaining logs
      Delete "$LOCALAPPDATA\@comfyorg\comfyui-electron\*.log"
      
      ; Clean registry entries if any
      DeleteRegKey HKCU "Software\ComfyUI"
      
      DetailPrint "Complete removal finished."
      Goto RemovalDone
    
    StandardRemoval:
      ; Standard removal - keep user data but clean up installation artifacts
      DetailPrint "Performing standard removal (keeping user data and models)..."
      
      ; Read base_path from config to find .venv location
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
          ; Remove Python virtual environment and cache
          RMDir /r /REBOOTOK "$3\.venv"
          RMDir /r /REBOOTOK "$3\uv-cache"
          RMDir /r /REBOOTOK "$3\__pycache__"
          Delete "$3\*.pyc"

          ${ExitDo} ; No need to continue, break the cycle
        ${EndIf}
        FileRead $0 $line
      ${LoopUntil} 1 = 0

      FileClose $0
      
      ; Remove only configuration files (not user data)
      Delete "$APPDATA\ComfyUI\extra_models_config.yaml"
      Delete "$APPDATA\ComfyUI\config.json"
      
      ; Remove temp and cache directories
      RMDir /r /REBOOTOK "$APPDATA\ComfyUI\temp"
      RMDir /r /REBOOTOK "$APPDATA\ComfyUI\cache"
      
      DetailPrint "Standard removal finished. User data and models preserved."
    
    RemovalDone:
  ${endIf}
!macroend
