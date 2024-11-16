# comfyui-electron

[![codecov](https://codecov.io/github/Comfy-Org/electron/graph/badge.svg?token=S64WJWD2ZX)](https://codecov.io/github/Comfy-Org/electron)

# Overview

This electron app is the simplest way to use [ComfyUI](https://github.com/comfyanonymous/ComfyUI) and comes bundled with a few things:

- Stable version of ComfyUI from [releases](https://github.com/comfyanonymous/ComfyUI/releases)
- comfyui [manager-core](https://github.com/Comfy-Org/manager-core)
- [uv](https://github.com/astral-sh/uv)

On startup, it will install all the necessary python dependencies with uv and start the ComfyUI server. The app will automatically update with stable releases of ComfyUI, ComfyUI-Manager, and the uv executable.

## Installed Files

### Electron

The desktop application comes bundled with:

- ComfyUI source code
- ComfyUI-Manager
- Electron, Chromium binaries, and node modules

**Windows**

We use the [NSIS installer](https://www.electron.build/nsis.html) for Windows and it will install files in these locations:

Bundled Resources: `%APPDATA%\Local\Programs\comfyui-electron`

![screenshot of resources directory](https://github.com/user-attachments/assets/0e1d4a9a-7b7e-4536-ad4b-9e6123873706)

User files are stored here: `%APPDATA%\Roaming\ComfyUI`

Automatic Updates: `%APPDATA%\Local\comfyui-electron-updater`

**macOS**

The macOS application is distributed as a [DMG](https://www.electron.build/dmg) and will install files in:

`~/Library/Application Support/ComfyUI`

The application will be dragged into `/Applications`

**Linux**

`~/.config/ComfyUI`

### ComfyUI

ComfyUI will also write files to disk as you use it. You will also be asked to select a location to store ComfyUI files like models, inputs, outputs, custom_nodes and saved workflows.

An `extra_model_config.yaml` is created to tell ComfyUI where to look for these files. You can edit this file to do things like add additional model files to the search path.

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

## NPM Dependencies

### Node

We recommend using [nvm](https://github.com/nvm-sh/nvm) to manage node versions. This project uses node v20.x.

### Yarn

This project uses `yarn` as its package manager. If you do not already have a `yarn` binary available on your PATH, run:

```bash
# corepack is a set of utilities included with all recent distributions of node
corepack enable
yarn set version v4.5.0 # Look at the packageManager key in package.json for the exact version.
```

This will install a usable `yarn` binary. Then, in the root directory of this repo (ie adjacent to the top-level package.json file), run:

```bash
yarn install
```

## ComfyUI Assets

Before you can start the electron application, you need to download the ComfyUI source code and other things that are usually bundled with the application. We use [comfy-cli](https://github.com/Comfy-Org/comfy-cli) to install everything.

### Setup Python

Make sure you have python 3.12+ installed. It is recommended to setup a virtual environment.

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

### Install comfy-cli

With the python environment activated, install comfy-cli:

```bash
pip install -U comfy-cli
```

### ComfyUI and other dependencies

First, initialize the application resources by running `make:assets:<gpu>`:

```bash
# populate the assets/ dir (Installs a fresh ComfyUI instance under assets/)
yarn make:assets:[amd|cpu|nvidia|macos]
```

This command will install ComfyUI under `assets`, as well ComfyUI-Manager, and the frontend [extension](https://github.com/Comfy-Org/DesktopSettingsExtension) responsible for electron settings menu. The exact versions of each package is defined in `package.json`.

Second, you need to install `uv`. This will be bundled with the distributable, but we also need it locally.

`yarn download:uv`

You can then run `start` to build/launch the code and a live buildserver that will automatically rebuild the code on any changes:

```bash
yarn start
```

You can also build the package and/or distributables using the `make` command:

```bash
# build the platform-dependent package and any distributables
yarn make
```

If you get an error similar to:

```
The module '/electron/node_modules/node-pty/build/Release/pty.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 125. Please try re-compiling or re-installing the module (for instance, using `npm rebuild` or `npm install`).
```

You will need to rebuild the node-pty using [electron-rebuild](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules), for example:

```
npx electron-rebuild
```

or if that fails

```
yarn install -D electron-rebuild
rm -rf node_modules
rm yarn.lock
yarn install
electron-rebuild
```

### Debugger

There are helpful debug launch scripts for VSCode / Cursor under `.vscode/launch.json`. It will start the dev server as defined in `.vscode/tasks.json`. Then attach the debugger.

This can be used simply by pressing `F5` in VSCode or VSCode derivative.

# Release

We use Todesktop to build and codesign our distributables. To make a new release:

1. Make a PR with the semantic version. eg. `v1.0.1`
1. Add the label `Release` to the PR.
1. Merge the PR
1. A build will automatically start and you can view it at https://app.todesktop.com

### Publish Locally

Follow the above steps for local development setup first.

```bash
# Authentication will be required.
yarn publish
```

## Utility scripts

A number of utility scripts are defined under the "scripts" field of package.json. For example, to clean up the build artifacts you can run:

```bash
yarn clean

# Remove files created by yarn make:assets:<gpu>
yarn:clean:assets

# clean:slate also removes node_modules
yarn clean:slate
```

# Download

Windows NSIS x64: [Download](https://download.comfy.org/windows/nsis/x64)

macOS ARM
