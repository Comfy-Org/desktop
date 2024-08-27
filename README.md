# comfyui-electron

## Install

This project uses `yarn` as its package manager. If you do not already have a `yarn` binary available on your PATH, run:

```bash
# corepack is a set of utilities included with all recent distributions of node
corepack enable
```

This will install a usable `yarn` binary. Then, in the root directory of this repo (ie adjacent to the top-level package.json file), run:

```bash
yarn install
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
