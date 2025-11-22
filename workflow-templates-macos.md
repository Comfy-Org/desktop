# MacOS workflow-templates missing on startup

## Current trace
- `yarn make:assets` (scripts/makeComfy.js) clones ComfyUI + Manager, downloads uv, applies `scripts/core-requirements.patch`. Patch only removes `comfyui-frontend-package`; it keeps `comfyui-workflow-templates==0.6.0` and `comfyui-embedded-docs==0.3.1` in `assets/ComfyUI/requirements.txt`. The committed `assets/requirements/macos.compiled` already includes both packages.
- ToDesktop build: `scripts/todesktop/beforeInstall.cjs` runs first. On mac it installs brew `python@3.12`, but then tries to resolve `python3.13` (variable mismatch). If it fails, the PYTHON/PATH overrides for node-gyp are skipped, but this is build-time only; runtime venv is unaffected. After packaging, `scripts/todesktop/afterPack.cjs` copies the entire `assets` folder into `Contents/Resources`, strips .git folders, removes non-mac uv, and chmods `uv` binaries.
- Startup: `InstallationManager.ensureInstalled()` → `ComfyInstallation` → `VirtualEnvironment`. For packaged builds `resourcesPath` is `Contents/Resources`. `VirtualEnvironment.create()` calls `uv venv --python 3.12 --python-preference only-managed`, `ensurepip`, then installs from `requirements/macos.compiled` (expects workflow-templates). If that fails it falls back to `installComfyUIRequirements()` (same requirements.txt) and Manager requirements. `hasRequirements()` uses `uv pip install --dry-run -r requirements.txt`; missing `comfyui-workflow-templates` is treated as a package upgrade and triggers a reinstall via `updatePackages()`.
- Runtime server: `ComfyServer.start()` runs `.venv/bin/python main.py` under the user base path. If `comfyui_workflow_templates` is truly missing, the ModuleNotFound surfaces in the ComfyUI log.

## Notes
- The patch is not removing `comfyui-embedded-docs`; both docs and workflow-templates remain in the repo and compiled lockfiles.
- No double-venv at runtime: the `/tmp/todesktop-python` venv from beforeInstall is only for build-time node-gyp; the app uses `.venv` under the user base path created by uv.

## Suggested checks on macOS
1) Inspect the bundled files: `ls "ComfyUI.app/Contents/Resources/requirements"` and `grep comfyui-workflow-templates ComfyUI.app/Contents/Resources/requirements/macos.compiled` (or inside the packaged zip).
2) If a user has an existing install, check their venv: `source ~/.local/share/ComfyUI/.venv/bin/activate && python -m pip show comfyui-workflow-templates comfyui-embedded-docs` (adjust base path). If missing, run `uv pip install --dry-run -r .../ComfyUI/requirements.txt` to see if the upgrade path is triggered.
3) During app start, confirm which requirements file is used by logging `this.requirementsCompiledPath` and whether `installRequirements` falls back to `manualInstall` (non-zero exit from uv pip install could silently skip).
4) Validate brew Python mismatch in `beforeInstall.cjs` (looks for `python3.13` while installing `python@3.12`); fix if node-pty builds are failing on mac builders, though it should not affect runtime packages.
