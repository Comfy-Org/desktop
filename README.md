# ComfyUI Desktop (beta)

[![codecov](https://codecov.io/github/Comfy-Org/electron/graph/badge.svg?token=S64WJWD2ZX)](https://codecov.io/github/Comfy-Org/electron)
![Beta](https://img.shields.io/badge/beta-blue.svg)

# USER GUIDE

Please read this https://comfyorg.notion.site

# Download

Windows (NVIDIA) NSIS x64: [Download](https://download.comfy.org/windows/nsis/x64)

macOS ARM: [Download](https://download.comfy.org/mac/dmg/arm64)

# Overview

This desktop app is a packaged way to use [ComfyUI](https://github.com/comfyanonymous/ComfyUI) and comes bundled with a few things:

- Stable version of ComfyUI from [releases](https://github.com/comfyanonymous/ComfyUI/releases)
- [ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend)
- [ComfyUI-Manager](https://github.com/ltdrdata/ComfyUI-Manager)
- [uv](https://github.com/astral-sh/uv)

On startup, it will install all the necessary python dependencies with uv and start the ComfyUI server. The app will automatically update with stable releases of ComfyUI, ComfyUI-Manager, and the uv executable as well as some desktop specific features.

Developers, read on.

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

User files are stored here: `%APPDATA%\ComfyUI`

Automatic Updates: `%APPDATA%\Local\comfyui-electron-updater`

**macOS**

The macOS application is distributed as a [DMG](https://www.electron.build/dmg) and will install files in:

`~/Library/Application Support/ComfyUI`

The application will be dragged into `/Applications`

**Linux**

`~/.config/ComfyUI`

### ComfyUI

You will also be asked to select a location to store ComfyUI files like models, inputs, outputs, custom_nodes and saved workflows. This directory is stored in the `basePath` key of `config.json`.

On Windows: `%APPDATA%\ComfyUI\config.json`

On macOS: `~/Library/Application Support/ComfyUI/config.json`

On Linux: `~/.config/ComfyUI/config.json`

#### Model Paths

This directory is also written as the `base_path` in `extra_model_config.yaml`. The Desktop app will look for model checkpoints here by default, but you can add additional models to the search path by editing this file.

On Windows: `%APPDATA%\ComfyUI\extra_model_config.yaml`

On macOS: `~/Library/Application Support/ComfyUI/extra_model_config.yaml`

On Linux: `~/.config/ComfyUI/extra_model_config.yaml`

### Logs

We use electron-log to log everything. Electron main process logs are in `main.log`, and ComfyUI server logs are in `comfyui_<date>.log`.

```
on Linux: ~/.config/{app name}/logs
on macOS: ~/Library/Logs/{app name}
on Windows: %AppData%\{app name}\logs
```

# Development

## Setup Python

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

## Windows

### Visual Studio

Visual studio 2019 or later with the Desktop C++ workload is required for `node-gyp`. See the `node-gyp` [windows installation notes](https://github.com/nodejs/node-gyp#on-windows). Also requires the `spectre-mitigated` libraries, found in the individual components section of the VS installer.

Confirmed working:

- Visual Studio Community 2022 - 17.12.1
- Desktop development with C++ workload
- MSVC v143 x64 spectre-mitigated libraries (Latest / v14.42-17.12)
  - Open the Visual Studio Installer
  - Click "Modify" on your Visual Studio 2022 Community installation
  - Go to the "Individual Components" tab
  - Search for "Spectre"
  - Check the boxes for the Spectre-mitigated libraries that match your project's architecture (x86 and/or x64)
  - ![image](https://github.com/user-attachments/assets/0829db3d-84b7-48e8-9d13-c72c35169a05)

Look for "MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs"
If you're using other toolsets, you may need their corresponding Spectre-mitigated libraries as well

## NPM Dependencies

### Node

We recommend using [nvm](https://github.com/nvm-sh/nvm) to manage node versions. This project uses node v20.x.

#### Windows

Microsoft recommends [nvm-windows](https://github.com/coreybutler/nvm-windows) on their [Node.js on Windows page](https://learn.microsoft.com/en-us/windows/dev-environment/javascript/nodejs-on-windows#install-nvm-windows-nodejs-and-npm).

```ps1
nvm install 20
nvm use 20
```

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

```bash
yarn download:uv
```

You can then run `start` to build/launch the code and a live buildserver that will automatically rebuild the code on any changes:

```bash
deactivate # Deactivate your existing python env to avoid influencing the
yarn start
```

You can also build the package and/or distributables using the `make` command:

```bash
# build the platform-dependent package and any distributables
yarn make
# build cross-platform, e.g. windows from linux
yarn make --windows
```

### Troubleshooting

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
yarn install -D @electron/rebuild
rm -rf node_modules
rm yarn.lock
yarn install
electron-rebuild
```

#### Missing libraries

You may get errors reporting that the build is unable to find e.g. `libnss3.so` if `electron` prerequisites are not included in your distro. Find the correct package for your distro and install.

`apt` example:

```
apt-get install libnss3
```

### Debugger

There are helpful debug launch scripts for VSCode / Cursor under `.vscode/launch.json`. It will start the dev server as defined in `.vscode/tasks.json`. Then attach the debugger.

This can be used simply by pressing `F5` in VSCode or VSCode derivative.

The launch environment can be customised, e.g. add a `"linux"` section to source your `~/.profile` (and other interactive config) when debugging in linux:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "linux": { "options": { "shell": { "args": ["-ci"] } } }
    }
  ]
}
```

# Release

We use Todesktop to build and codesign our distributables. To make a new release:

1. Create a PR that updates package.json to the next version.
1. Create a Github Release with semantic version tag eg. "v1.0.0"
1. Make sure it is a pre-release.
1. Check the Github action "Publish All" runs. It should update the release body with Download links when it is finished.
1. Test the build, and if it looks good release it on ToDesktop. Also mark the release as "Latest".

If a build fails for some reason, you can manually retry by running the "Publish All" GH action with a release tag as input.

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

# Crash Reports

At the onboarding step, you can opt-in to send us crash reports, which **only** include stack trace for unhandled exceptions and native crashes. These are really helpful to help us debug issues in lieu of an actual Github bug report. However, you can opt-out and nothing will ever be sent. We use Sentry to send crash reports. Code [here](https://github.com/Comfy-Org/desktop/blob/main/src/services/sentry.ts).

In either case, no personal data, workflows or logs will be sent.
