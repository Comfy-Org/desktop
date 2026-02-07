#!/usr/bin/env bash
set -euo pipefail

requirements_path="${1:-assets/ComfyUI/requirements.txt}"
output_patch="${2:-scripts/core-requirements.patch}"

if [[ ! -f "$requirements_path" ]]; then
  echo "Requirements file not found: $requirements_path" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

original_requirements="$tmp_dir/requirements.original.txt"
patched_requirements="$tmp_dir/requirements.patched.txt"

cp "$requirements_path" "$original_requirements"

if ! grep -q '^comfyui-frontend-package==' "$original_requirements"; then
  echo "Missing comfyui-frontend-package pin in: $requirements_path" >&2
  exit 1
fi

grep -v '^comfyui-frontend-package==' "$original_requirements" > "$patched_requirements"

if cmp -s "$original_requirements" "$patched_requirements"; then
  echo "No changes detected after removing comfyui-frontend-package from $requirements_path" >&2
  exit 1
fi

diff_body="$(diff -u --label a/requirements.txt --label b/requirements.txt "$original_requirements" "$patched_requirements" || true)"

if [[ -z "$diff_body" ]]; then
  echo "Failed to generate patch body for $requirements_path" >&2
  exit 1
fi

{
  echo "diff --git a/requirements.txt b/requirements.txt"
  echo "$diff_body"
} > "$output_patch"

echo "Wrote $output_patch from $requirements_path"
