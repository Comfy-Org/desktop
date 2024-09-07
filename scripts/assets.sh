#!/usr/bin/env bash
set -e

comfy-cli --skip-prompt --workspace ./ComfyUI install --fast-deps --amd
comfy-cli --workspace ./ComfyUI standalone
rm -rf python cpython*.tar.gz
