# comfyui-electron

# Overview

This electron app is the simplest way to use [ComfyUI](https://github.com/comfyanonymous/ComfyUI) comes bundled with a few things:

- [standalone](https://github.com/indygreg/python-build-standalone) python runtime
- comfyui manager [core](https://github.com/Comfy-Org/manager-core)
- [comfy-cli](https://github.com/Comfy-Org/comfy-cli)
- [uv](https://github.com/astral-sh/uv)

On startup, it will install all the necessary python dependencies and start the server.

We publish updates in line with the stable releases of ComfyUI.

The app uses our electron update server hosted at https://updater.comfy.org.

## Application Files

### Electron

The desktop application comes bundled with:

- ComfyUI source code
- ComfyUI-Manager
- Electron, Chromium binaries, and node modules

These are placed here by the installer:

On Windows: `%APPDATA%\Roaming\ComfyUI` and `%APPDATA%\Local\comfyui-electron-updater`

On macOS: `~/Library/Application Support/ComfyUI`

On Linux: `~/.config/ComfyUI`

### ComfyUI

You will also be asked to select a location to store ComfyUI files like models, inputs, outputs, custom_nodes and saved workflows.

An `extra_model_config.yaml` is created to store the paths to this directory. You can edit it to add additional model paths that you want to use.

On Windows: `%APPDATA%\Roaming\ComfyUI\extra_model_config.yaml`

On macOS: `~/Library/Application Support/ComfyUI/extra_model_config.yaml`

On Linux: `~/.config/ComfyUI/extra_model_config.yaml`

### Logs

We use electron-log to log everything. Electron main process logs are in `main.log`, and ComfyUI server logs are in `comfyui_<date>.log`.

```
on Linux: ~/.config/{app name}/logs
on macOS: ~/Library/Logs/{app name}
on Windows: %AppData%\Roaming\{app name}\logs
```

# Development

## Local Server

This project uses `yarn` as its package manager. If you do not already have a `yarn` binary available on your PATH, run:

```bash
# corepack is a set of utilities included with all recent distributions of node
corepack enable
yarn set version stable
```

This will install a usable `yarn` binary. Then, in the root directory of this repo (ie adjacent to the top-level package.json file), run:

```bash
yarn install
```

Start the development server:

```bash
yarn start
```

## Setup Python

Make sure you have python 3.12+ installed. It is recommended to setup a virtual environment to run the python code.

Linux/MacOS:

```bash
python -m venv venv
source venv/bin/activate
```

Windows:

```powershell
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
```

## Setup comfy-cli

With the python environment activated, install comfy-cli:

```bash
pip install comfy-cli
```

## Building/running

First, initialize the application resources by running `make:assets:<gpu>`:

```bash
# populate the assets/ dir (Installs a fresh ComfyUI instance under assets/)
yarn make:assets:[amd|cpu|nvidia|macos]
```

This command will install ComfyUI under `assets`, as well ComfyUI-Manager, and the frontend [extension](https://github.com/Comfy-Org/DesktopSettingsExtension) responsible for electron settings menu.

You can then run `start` to build/launch the code and a live buildserver that will automatically rebuild the code on any changes:

```bash
yarn start
```

You can also build the package and/or distributables using the `make` command:

```bash
# build the platform-dependent package and any distributables
yarn make
```

# Release

We use Todesktop to build and codesign our releases. To make a new release:

1. Make a PR titled "v<semantic version>"
2. Add the label "Release" (case sensitive)
3. Merge the PR
4. A build will automatically start and you can view it at https://app.todesktop.com

### Publish Locally

```bash
# Authentication will be required.
yarn publish
```

## Utility scripts

A number of utility scripts are defined under the "scripts" field of package.json. For example, to clean up the build artifacts you can run:

```bash
yarn clean

# clean:slate also removes node_modules
yarn clean:slate
```

# Download

## Windows

x64 [Download](https://download.comfy.org/windows/nsis/x64)

## Mac

ARM64 [Download]()
