# Testing

## Unit Tests

Unit tests are run with vitest. Tests are run in parallel.

### Running

```bash
pnpm test:unit
```

## End-to-End Tests

End-to-end tests are run with Playwright. Tests are run sequentially.

Tests are intended to be run on virtualised, disposable systems, such as CI runners.

> [!CAUTION]
> End-to-end tests erase settings and other app data. They will delete ComfyUI directories without warning.

### Enabling E2E tests

To run tests properly outside of CI, set env var `COMFYUI_ENABLE_VOLATILE_TESTS=1` or use `.env.test`.

> [!TIP]
> Copy `.env.test_example` to `.env.test` and modify as needed.

### Running

```bash
pnpm test:e2e
```

> [!NOTE]
> As a precaution, if the app data directory already exists, it will have a random suffix appended to its name.

App data directories:

- `%APPDATA%\ComfyUI` (Windows)
- `Application Support/ComfyUI` (Mac)

### Updating screenshots (snapshots)

When test screenshots are out of date, they must be updated with the following process:

1. Run tests
2. Manually verify that the only things changed are what's expected
3. Run this locally:
   ```bash
   npm run test:e2e:update
   ```
4. Commit new expectations

> [!TIP]
> All screenshot expectations are overwritten by playwright. To update a single test, discard any unrelated changes before committing.
