!include 'LogicLib.nsh'

${UnStrStr}

Section uninstall
  ClearErrors
  FileOpen $0 "$APPDATA\ComfyUI\extra_models_config.yaml" r
  var /global line
  FileRead $0 $line
  ${DoUntil} ${Errors}
    ${UnStrStr} $1 $line "base_path:" ; Find base_path prefix in the line
    ${If} $1 != ""
      StrCpy $2 $1 1024 10 ; Strip off first 10 characters (base_path:)

      ; $2 now contains value of base_path
      RMDir "$2\.venv"
      RMDir "$2\uv-cache"
    ${EndIf}
    FileRead $0 $line
  ${LoopUntil} 1 = 0

  FileClose $0
  Delete "$APPDATA\ComfyUI\extra_models_config.yaml"
SectionEnd
