# ComfyUI Desktop - Claude Code Instructions

## Project Overview
**ComfyUI Desktop** (@comfyorg/comfyui-electron) is an Electron-based desktop application that packages ComfyUI with a user-friendly interface. It's "the best modular GUI to run AI diffusion models" and automatically handles Python environment setup, dependency management, and provides a seamless desktop experience for running AI models.

- **Version**: 0.4.51
- **License**: GPL-3.0-only
- **Repository**: github:comfy-org/electron
- **Homepage**: https://comfy.org

## Key Technologies
- **Electron 31.3.1** - Desktop app framework
- **TypeScript 5.7.2** - Primary language
- **Vite 5.4.11** - Build tool and bundler
- **Node.js v20.x** - Runtime (use nvm)
- **Yarn 4.5.0** - Package manager
- **Vitest 2.1.9** - Unit testing
- **Playwright 1.47.2** - E2E testing
- **ESLint 9.17.0** - Linting
- **Prettier 3.3.3** - Formatting

## Development Commands

### Code Quality (ALWAYS RUN AFTER CHANGES)
```bash
yarn lint              # Check ESLint issues
yarn lint:fix          # Auto-fix ESLint issues
yarn format            # Check Prettier formatting
yarn format:fix        # Auto-format code
yarn typescript        # TypeScript type checking
```

### Development
```bash
yarn start             # Build and launch app with file watching
yarn make:assets       # Download ComfyUI dependencies
yarn clean             # Remove build artifacts
```

### Testing
```bash
yarn test:unit         # Run unit tests (Vitest)
yarn test:e2e          # Run E2E tests (Playwright)
yarn test:e2e:update   # Update Playwright snapshots
```

### Building
```bash
yarn make              # Build platform package
yarn make:nvidia       # Build with NVIDIA GPU support
yarn vite:compile      # Compile with Vite
```

## Project Structure

### Source Code (`/src/`)
- **`main.ts`** - Main Electron process entry point
- **`desktopApp.ts`** - Core application logic
- **`preload.ts`** - Electron preload script
- **`main-process/`** - Main process modules
  - `comfyDesktopApp.ts` - ComfyUI server management
  - `appWindow.ts` - Window management
  - `comfyServer.ts` - Server lifecycle
- **`install/`** - Installation & setup logic
- **`handlers/`** - IPC message handlers
- **`services/`** - Core services (telemetry, Sentry)
- **`config/`** - Configuration management
- **`store/`** - Persistent storage
- **`utils.ts`** - Utility functions

### Tests (`/tests/`)
- **`unit/`** - Vitest-based component tests
- **`integration/`** - Playwright E2E tests
  - `install/` - Fresh installation testing
  - `post-install/` - Tests after app setup
  - `shared/` - Common test functionality

## Development Setup
- **Python 3.12+** with virtual environment support required
- **Node.js v20.x** (use nvm for version management)
- **Visual Studio 2019+** with C++ workload (Windows)
- **Spectre-mitigated libraries** for node-gyp compilation

## Important Files & Configuration
- **`package.json`** - Defines ComfyUI versions and dependencies
- **`assets/requirements/`** - Pre-compiled Python requirements by platform
- **`todesktop.json`** - Cloud build and distribution config
- **`builder-debug.config.ts`** - Local development build settings
- **Multi-config Vite setup** with separate configs for main, preload, and types

## Bundled Components
The app packages these components:
- **ComfyUI** - AI diffusion model GUI
- **ComfyUI_frontend** - Modern web frontend
- **ComfyUI-Manager** - Plugin/extension manager
- **uv** - Fast Python package manager

## Development Environment Variables
- **`--dev-mode`** - Flag for packaged apps in development
- **`COMFY_HOST`/`COMFY_PORT`** - External server for development
- **`VUE_DEVTOOLS_PATH`** - Frontend debugging support

## Platform-Specific Paths
- **Windows**: `%APPDATA%\ComfyUI` (config), `%APPDATA%\Local\Programs\comfyui-electron` (app)
- **macOS**: `~/Library/Application Support/ComfyUI`
- **Linux**: `~/.config/ComfyUI`

## Code Style & Conventions
- Follow existing TypeScript patterns in the codebase
- Use ESLint and Prettier for code formatting
- Maintain clean separation between main process, renderer, and preload scripts
- Follow Electron security best practices
- Use the existing store patterns for configuration management
- Test changes with both unit tests (Vitest) and E2E tests (Playwright)

## Before Committing
1. Run `yarn lint` and `yarn typescript` to check code quality
2. Run `yarn test:unit` to ensure unit tests pass
3. Consider running `yarn test:e2e` for UI changes
4. Use `yarn format:fix` to ensure consistent formatting

This is a sophisticated Electron application with comprehensive testing, automated CI/CD, cross-platform support, and professional development practices.