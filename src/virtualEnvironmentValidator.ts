import log from 'electron-log/main';

import type { ProcessCallbacks, VirtualEnvironment } from './virtualEnvironment';

/**
 * Result of virtual environment validation
 */
export type VenvValidationResult = {
  success: boolean;
  error?: string;
  missingImports?: string[];
};

/**
 * Generates a Python script that tests multiple imports and reports failures
 * @param imports Array of Python module names to test
 * @returns Python script as a string
 */
function generateImportTestScript(imports: string[]): string {
  return `
import json
import sys

failed_imports = []

for module_name in ${JSON.stringify(imports)}:
    try:
        __import__(module_name)
    except ImportError as e:
        failed_imports.append(module_name)

# Output results as JSON for easy parsing
print(json.dumps({
    "failed_imports": failed_imports,
    "success": len(failed_imports) == 0
}))

sys.exit(0 if len(failed_imports) == 0 else 1)
`;
}

/**
 * Validates that a virtual environment can successfully import critical packages.
 * This helps detect partial installations where uv may have failed silently.
 *
 * @param venv The virtual environment to validate
 * @param callbacks Optional callbacks for output handling
 * @returns Validation result indicating success or specific failure
 */
export async function validateVirtualEnvironment(venv: VirtualEnvironment): Promise<VenvValidationResult> {
  log.info('Validating virtual environment - testing yaml import');

  let output = '';

  const cb = (data: string) => (output += data);

  const callbacks = {
    onStdout: cb,
    onStderr: cb,
  } satisfies ProcessCallbacks;

  try {
    const { exitCode } = await venv.runPythonCommandAsync(['-c', YAML_IMPORT_TEST_SCRIPT], callbacks);

    if (exitCode === 0 && output.includes('yaml_import_success')) {
      log.info('Virtual environment validation successful - yaml imports correctly');
      return { success: true };
    }

    log.error('Virtual environment validation failed:', output);

    // Check if it's specifically a yaml import failure
    if (output.includes('yaml_import_failed') || output.toLowerCase().includes('yaml')) {
      return {
        success: false,
        error: 'Failed to import yaml module',
        missingPackage: 'pyyaml',
      };
    }

    return {
      success: false,
      error: `Python validation failed with exit code ${exitCode}: ${output}`,
    };
  } catch (error) {
    log.error('Error during virtual environment validation:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
}
