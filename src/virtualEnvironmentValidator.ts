import log from 'electron-log/main';

import type { ProcessCallbacks, VirtualEnvironment } from './virtualEnvironment';

/**
 * Result of virtual environment validation
 */
export type VenvValidationResult = {
  success: boolean;
  error?: string;
  missingPackage?: string;
};

/**
 * Test script that attempts to import yaml module
 */
const YAML_IMPORT_TEST_SCRIPT = `
import sys
try:
    import yaml
    print("yaml_import_success")
    sys.exit(0)
except ImportError as e:
    print(f"yaml_import_failed: {e}")
    sys.exit(1)
`;

/**
 * Validates that a virtual environment can successfully import critical packages.
 * This helps detect partial installations where uv may have failed silently.
 *
 * @param venv The virtual environment to validate
 * @param callbacks Optional callbacks for output handling
 * @returns Validation result indicating success or specific failure
 */
export async function validateVirtualEnvironment(
  venv: VirtualEnvironment,
  callbacks?: ProcessCallbacks
): Promise<VenvValidationResult> {
  log.info('Validating virtual environment - testing yaml import');

  let output = '';
  let errorOutput = '';

  const testCallbacks: ProcessCallbacks = {
    onStdout: (data) => {
      output += data;
      callbacks?.onStdout?.(data);
    },
    onStderr: (data) => {
      errorOutput += data;
      callbacks?.onStderr?.(data);
    },
  };

  try {
    const { exitCode } = await venv.runPythonCommandAsync(['-c', YAML_IMPORT_TEST_SCRIPT], testCallbacks);

    if (exitCode === 0 && output.includes('yaml_import_success')) {
      log.info('Virtual environment validation successful - yaml imports correctly');
      return { success: true };
    } else {
      const errorMessage = errorOutput || output;
      log.error('Virtual environment validation failed:', errorMessage);

      // Check if it's specifically a yaml import failure
      if (output.includes('yaml_import_failed') || errorMessage.toLowerCase().includes('yaml')) {
        return {
          success: false,
          error: 'Failed to import yaml module',
          missingPackage: 'pyyaml',
        };
      }

      return {
        success: false,
        error: `Python validation failed with exit code ${exitCode}: ${errorMessage}`,
      };
    }
  } catch (error) {
    log.error('Error during virtual environment validation:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
}

/**
 * Attempts to repair a virtual environment with missing packages.
 * This is useful when uv fails silently and leaves a partial installation.
 *
 * @param venv The virtual environment to repair
 * @param missingPackages List of packages to install
 * @param callbacks Optional callbacks for output handling
 * @returns True if repair was successful, false otherwise
 */
export async function repairVirtualEnvironment(
  venv: VirtualEnvironment,
  missingPackages: string[],
  callbacks?: ProcessCallbacks
): Promise<boolean> {
  log.info(`Attempting to repair virtual environment - installing missing packages: ${missingPackages.join(', ')}`);

  try {
    // Fall back to manual installation for the missing packages
    const { exitCode } = await venv.runPythonCommandAsync(['-m', 'pip', 'install', ...missingPackages], callbacks);

    if (exitCode === 0) {
      log.info('Successfully repaired virtual environment');
      return true;
    } else {
      log.error(`Failed to repair virtual environment - pip install exited with code ${exitCode}`);
      return false;
    }
  } catch (error) {
    log.error('Error during virtual environment repair:', error);
    return false;
  }
}
