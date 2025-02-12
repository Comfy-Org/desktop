# Testing

## Unit Tests

Unit tests are run with vitest. Tests are run in parallel.

### Running

```bash
yarn run test:unit
```

## End-to-End Tests

End-to-end tests are run with Playwright. Tests are run sequentially.

> [!CAUTION]
> End-to-end tests erase settings and other app data. They will delete ComfyUI directories without warning.

These tests are designed to be run in CI or a virtual machine.

### Running

```bash
yarn run test:e2e
```

> [!NOTE]
> As a precaution, if the app data directory already exists, it will have a random suffix appended to its name.

App data directories:

- `%APPDATA%\ComfyUI` (Windows)
- `Application Support/ComfyUI` (Mac)
