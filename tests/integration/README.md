# ComfyUI Desktop Integration Testing Guide

This document provides a comprehensive overview of the integration testing infrastructure for ComfyUI Desktop. It is designed to enable Claude Code engineers to immediately write effective integration tests without needing to analyze the infrastructure files.

## Core Testing Framework

### Technology Stack

- **Playwright**: E2E testing framework for Electron applications
- **TypeScript**: All test files use TypeScript
- **Test Runner**: Playwright Test with custom fixtures
- **Location**: All integration tests live in `/tests/integration/`

### Environment Control

Integration tests require the environment variable `COMFYUI_ENABLE_VOLATILE_TESTS=1` to be set (or running in CI). This prevents accidental execution on development machines.

## Test Architecture

### 1. Test Projects Structure

The testing suite is organized into distinct projects with dependencies:

```typescript
// From playwright.config.ts
projects: [
  'install'                 // Fresh install tests (no pre-existing state)
  'post-install-setup'      // Sets up an installed app state
  'post-install'            // Tests that require an installed app
  'post-install-teardown'   // Cleanup after post-install tests
]
```

**Project Dependencies:**

- `post-install-setup` depends on `install` completing first
- `post-install` depends on `post-install-setup`
- `post-install-teardown` runs after all post-install tests

### 2. Core Infrastructure Classes

#### TestApp (testApp.ts)

The main test application wrapper that manages the Electron process:

```typescript
class TestApp {
  testEnvironment: TestEnvironment; // Manages app data and installation
  app: ElectronApplication; // Playwright's Electron wrapper

  // Key methods:
  static create(testInfo); // Factory to launch Electron
  firstWindow(); // Get the main window
  browserWindow(); // Get browser window handle
  close(); // Gracefully close the app
  [Symbol.asyncDispose](); // Cleanup on test end
}
```

#### TestEnvironment (testEnvironment.ts)

Manages the application's file system state and configuration:

```typescript
class TestEnvironment {
  appDataDir: string; // ComfyUI app data directory
  configPath: string; // config.json location
  installLocation: TempDirectory; // Temporary install directory
  defaultInstallLocation: string; // Default ComfyUI install path

  // Test helper methods:
  readConfig(); // Read desktop settings
  breakInstallPath(); // Simulate broken installation
  breakVenv(); // Simulate broken Python environment
  breakServerStart(); // Simulate server startup failure
  deleteEverything(); // Complete cleanup

  // Auto-restoration on dispose
  [Symbol.asyncDispose](); // Restores any broken states
}
```

### 3. UI Component Test Classes

Each major UI component has a dedicated test class that encapsulates its locators and interactions:

#### TestInstallWizard (testInstallWizard.ts)

```typescript
class TestInstallWizard {
  // Buttons
  getStartedButton;
  nextButton;
  installButton;

  // Controls
  cpuToggle; // CPU mode toggle
  installLocationInput; // Installation path input

  // Screen titles for navigation verification
  selectGpuTitle;
  installLocationTitle;
  migrateTitle;
  desktopSettingsTitle;
}
```

#### TestInstalledApp (testInstalledApp.ts)

```typescript
class TestInstalledApp {
  graphCanvas: TestGraphCanvas; // Graph editor component
  vueApp; // Main Vue application
  uiBlockedSpinner; // Loading spinner

  waitUntilLoaded(timeout); // Wait for app to be fully ready
}
```

#### TestServerStart (testServerStart.ts)

```typescript
class TestServerStart {
  // Buttons
  openLogsButton;
  troubleshootButton;
  showTerminalButton;

  terminal; // Terminal output display
  status: TestServerStatus; // Server status component

  expectServerStarts(timeout); // Wait for server to start
  encounteredError(); // Check if error occurred
}
```

#### TestTroubleshooting (testTroubleshooting.ts)

```typescript
class TestTroubleshooting {
  // Task cards for different fixes
  basePathCard: TestTaskCard; // Fix installation path
  vcRedistCard: TestTaskCard; // Install VC++ redistributable
  installPythonPackagesCard; // Reinstall Python packages
  resetVenvCard; // Reset virtual environment

  refreshButton; // Refresh troubleshooting status
  expectReady(); // Wait for page to load
}
```

## Test Fixtures

The test framework provides these fixtures automatically via `testExtensions.ts`:

```typescript
interface DesktopTestFixtures {
  // Core fixtures
  app: TestApp; // The Electron application
  window: Page; // Main Playwright page object

  // UI Component fixtures
  troubleshooting: TestTroubleshooting;
  installWizard: TestInstallWizard;
  serverStart: TestServerStart;
  installedApp: TestInstalledApp;
  graphCanvas: TestGraphCanvas;

  // Utility fixtures
  attachScreenshot: (name) => Promise<void>; // Attach screenshot to test
}
```

### Using Fixtures in Tests

Import and destructure the fixtures you need:

```typescript
import { expect, test } from '../testExtensions';

test('My test', async ({ app, window, installWizard }) => {
  // Fixtures are automatically initialized and cleaned up
  await installWizard.clickGetStarted();
  await expect(window).toHaveScreenshot('started.png');
});
```

## Writing Tests

### 1. Basic Test Structure

```typescript
import { expect, test } from '../testExtensions';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ app }) => {
    // Setup that runs before each test
  });

  test('should do something', async ({ window, installWizard }) => {
    // Your test logic here
    await installWizard.clickGetStarted();
    await expect(window).toHaveScreenshot('screenshot.png');
  });
});
```

### 2. Installation Tests (Fresh Start)

Place in `/tests/integration/install/`:

```typescript
test('Can install app', async ({ installWizard, installedApp, serverStart, app }) => {
  test.slow(); // Mark as slow test

  // Navigate through installation
  await installWizard.clickGetStarted();
  await installWizard.cpuToggle.click();
  await installWizard.clickNext();

  // Set install location
  const { installLocation } = app.testEnvironment;
  await installWizard.installLocationInput.fill(installLocation.path);
  await installWizard.clickNext();

  // Complete installation
  await installWizard.installButton.click();

  // Wait for server to start
  await serverStart.expectServerStarts();
  await installedApp.waitUntilLoaded();
});
```

### 3. Post-Install Tests (With Existing Installation)

Place in `/tests/integration/post-install/`:

```typescript
test.describe('Troubleshooting - broken install path', () => {
  test.beforeEach(async ({ app }) => {
    // Break something to test recovery
    await app.testEnvironment.breakInstallPath();
  });

  test('Can fix install path', async ({ troubleshooting, serverStart }) => {
    await troubleshooting.expectReady();

    // Mock file dialog
    await app.app.evaluate((electron, filePath) => {
      electron.dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      });
    }, getDefaultInstallLocation());

    // Fix the path
    await troubleshooting.basePathCard.button.click();
    await serverStart.expectServerStarts();
  });
});
```

### 4. Testing Error States

The TestEnvironment provides methods to simulate common failure scenarios:

```typescript
// Simulate broken installation path
await app.testEnvironment.breakInstallPath();

// Simulate broken Python virtual environment
await app.testEnvironment.breakVenv();

// Simulate server startup failure
await app.testEnvironment.breakServerStart();

// All broken states are automatically restored after test
```

### 5. Screenshots and Assertions

```typescript
// Visual regression testing
await expect(window).toHaveScreenshot('name.png');

// With masks for dynamic content
await expect(window).toHaveScreenshot('error.png', {
  mask: [serverStart.status.errorDesktopVersion], // Masks version number
});

// Manual screenshot attachment
await attachScreenshot('debug-screenshot.png');

// Element visibility
await expect(installWizard.getStartedButton).toBeVisible();
await expect(serverStart.status.error).not.toBeVisible();

// Custom assertions with retry
await expect(async () => {
  await installedApp.graphCanvas.expectLoaded();
  await expect(installedApp.uiBlockedSpinner).not.toBeVisible();
}).toPass({ timeout: 60000, intervals: [500] });
```

## Test Patterns and Best Practices

### 1. Test Organization

- **install/**: Tests that require a fresh installation state
- **post-install/**: Tests that require an already-installed app
- **shared/**: Tests that work in both states

### 2. Timeouts

```typescript
// Default timeout: 60 seconds
// For slow operations:
test.slow(); // Triples the timeout

// Custom timeouts:
await expect(element).toBeVisible({ timeout: 5 * 60 * 1000 });
await serverStart.expectServerStarts(30 * 1000);
```

### 3. Cleanup and Isolation

- Tests automatically clean up via `Symbol.asyncDispose`
- Use `disposeTestEnvironment: true` option for complete cleanup
- The TestEnvironment automatically restores any broken states

### 4. Platform Differences

```typescript
// CI-specific behavior
const timeout = process.env.CI ? 60 * 1000 : 30 * 1000;

// Platform-specific paths handled by utilities
getDefaultInstallLocation(); // Returns platform-appropriate path
getComfyUIAppDataPath(); // Returns platform-specific app data
```

### 5. Working with Async Operations

```typescript
// Wait for multiple conditions
await expect(async () => {
  await graphCanvas.expectLoaded();
  await expect(uiBlockedSpinner).not.toBeVisible();
}).toPass({ timeout: 90000, intervals: [500] });

// Wait for any status to appear
await expect(serverStart.status.get()).resolves.not.toBe('unknown');
```

### 6. Mocking Native Dialogs

```typescript
// Mock file selection dialog
await app.app.evaluate((electron, selectedPath) => {
  electron.dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [selectedPath],
  });
}, '/path/to/select');
```

## Utility Functions

Available from `tests/shared/utils.ts`:

```typescript
// Path utilities
pathExists(path: string, permission?: FilePermission): Promise<boolean>
getComfyUIAppDataPath(): string          // Platform-specific app data
getDefaultInstallLocation(): string      // Platform-specific install location
addRandomSuffix(str: string): string     // Add UUID suffix

// Desktop operations
createDesktopScreenshot(filename: string): Promise<string>  // Full desktop screenshot
```

## Running Tests

### Local Development

```bash
# Set environment variable
export COMFYUI_ENABLE_VOLATILE_TESTS=1

# Run all integration tests
yarn test:e2e

# Run specific test file
yarn playwright test tests/integration/install/installWizard.spec.ts

# Run with UI mode for debugging
yarn playwright test --ui

# Update screenshots
yarn test:e2e:update
```

### CI Environment

Tests run automatically in CI with:

- 1 retry on failure
- Video/trace capture on first retry
- HTML report generation
- GitHub annotations for failures

## Common Scenarios

### Testing a New Installation Flow

1. Create test file in `/tests/integration/install/`
2. Use `installWizard` fixture to navigate
3. Verify with screenshots and element checks
4. Ensure `disposeTestEnvironment: true` for cleanup

### Testing Error Recovery

1. Use `TestEnvironment.break*()` methods to simulate failure
2. Verify error UI appears correctly
3. Implement fix via troubleshooting UI
4. Verify recovery completes successfully

### Testing Post-Install Features

1. Create test file in `/tests/integration/post-install/`
2. Rely on `post-install-setup` to provide installed state
3. Test feature assuming app is fully installed
4. No need for manual cleanup (handled by teardown)

## Key Points to Remember

1. **Always import from `testExtensions`**, not raw Playwright
2. **Use fixture classes** instead of raw locators
3. **Leverage TestEnvironment** for state manipulation
4. **Trust auto-cleanup** via Symbol.asyncDispose
5. **Use project dependencies** for test ordering
6. **Mock native dialogs** when needed
7. **Add screenshots** for visual regression testing
8. **Mark slow tests** with `test.slow()`
9. **Check CI behavior** with `process.env.CI`
10. **Use shared utilities** for common operations

This infrastructure provides a robust, maintainable way to test the ComfyUI Desktop application across different states and scenarios. The fixture-based approach ensures consistent test behavior and automatic cleanup, while the project structure enables both isolated and sequential testing scenarios.
