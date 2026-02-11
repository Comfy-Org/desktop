#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Re-run uv compile commands embedded in assets/requirements/*.compiled headers.

Usage:
  scripts/recompileRequirementsFromHeaders.sh [--dry-run] [compiled-file ...]

Examples:
  scripts/recompileRequirementsFromHeaders.sh --dry-run
  scripts/recompileRequirementsFromHeaders.sh
  scripts/recompileRequirementsFromHeaders.sh assets/requirements/macos.compiled
USAGE
}

dry_run=0
compiled_files=()

for argument in "$@"; do
  case "$argument" in
    --dry-run)
      dry_run=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $argument" >&2
      usage >&2
      exit 1
      ;;
    *)
      compiled_files+=("$argument")
      ;;
  esac
done

if [[ ! -f "package.json" || ! -d "assets/requirements" ]]; then
  echo "Run this script from the desktop repository root." >&2
  exit 1
fi

if [[ ${#compiled_files[@]} -eq 0 ]]; then
  mapfile -t compiled_files < <(find assets/requirements -maxdepth 1 -type f -name '*.compiled' | sort)
fi

if [[ ${#compiled_files[@]} -eq 0 ]]; then
  echo "No compiled requirements files found." >&2
  exit 1
fi

for compiled_file in "${compiled_files[@]}"; do
  if [[ ! -f "$compiled_file" ]]; then
    echo "Missing file: $compiled_file" >&2
    exit 1
  fi

  compile_command="$(
    awk '
      /^#/ {
        line = $0
        sub(/^#[[:space:]]*/, "", line)
        if (line ~ /^uv[[:space:]]+pip[[:space:]]+compile([[:space:]]|$)/) {
          print line
          exit
        }
      }
    ' "$compiled_file"
  )"
  if [[ -z "$compile_command" ]]; then
    echo "Could not extract uv pip compile command from header comments in $compiled_file" >&2
    exit 1
  fi

  output_path="$(printf '%s\n' "$compile_command" | awk '{
    for (i = 1; i <= NF; i++) {
      if ($i == "-o" && i < NF) {
        print $(i + 1)
        exit
      }
    }
  }')"
  if [[ -z "$output_path" ]]; then
    echo "Could not find output path (-o) in compile command for $compiled_file" >&2
    exit 1
  fi

  output_path="${output_path%\"}"
  output_path="${output_path#\"}"
  output_path="${output_path%\'}"
  output_path="${output_path#\'}"

  normalized_compiled_file="${compiled_file#./}"
  normalized_output_path="${output_path#./}"
  if [[ "$normalized_output_path" != "$normalized_compiled_file" ]]; then
    echo "Compile command output path mismatch for $compiled_file" >&2
    echo "Expected: $normalized_compiled_file" >&2
    echo "Found: $normalized_output_path" >&2
    exit 1
  fi

  echo "[$compiled_file]"
  echo "$compile_command"

  if [[ $dry_run -eq 0 ]]; then
    bash -c "$compile_command"
  fi
done
