# comfyui-electron

# Overview

This electron app distributes [ComfyUI](https://github.com/comfyanonymous/ComfyUI) and comes bundled with a few things:

- standalone python runtime
- comfyui manager [core](https://github.com/Comfy-Org/manager-core)
- [comfy-cli](https://github.com/Comfy-Org/comfy-cli)
- uv

On startup, it will install all the necessary python dependencies and start the server.

We publish updates via electron in line with the stable releases of ComfyUI.

## ComfyUI Files

ComfyUI files like models, inputs, outputs, custom_nodes and saved workflows are placed here:

Windows: `%USERPROFILE%/ComfyUI/...`

Mac: `~/Library/Application Support/ComfyUI`

## Logs

We use electron-log to log everything to a local file.

```
on Linux: ~/.config/{app name}/logs/main.log
on macOS: ~/Library/Logs/{app name}/main.log
on Windows: %USERPROFILE%\AppData\Roaming\{app name}\logs\main.log
```

# Development

## Install

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

## Building/running

First, initialize the application resources by running `make:assets:<gpu>`, for example:

```bash
# populate the assets/ dir
yarn make:assets:amd
```

You can then run `start` to build/launch the code and a live buildserver that will automatically rebuild the code on any changes:

```bash
yarn start
```

You can also build the package and/or distributables using the `package` and `make` commands:

```bash
# build the platform-dependent package
yarn package
```

```bash
# build the platform-dependent package and any distributables
yarn make
```

## Utility scripts

A number of utility scripts are defined under the "scripts" field of package.json. For example, to build the project, run:

```bash
yarn make
```

Then, to clean up the build artifacts you can run:

```bash
yarn clean

# clean:slate also removes node_modules
yarn clean:slate
```

# Download

## Windows

x64 [Download](https://updater.comfy.org/windows/latest)

## Mac

ARM64 [Download](https://updater.comfy.org/darwin/latest)
