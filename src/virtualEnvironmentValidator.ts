import Joi from 'joi';
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
 * Validates that a virtual environment can successfully import specified packages.
 * This helps detect partial installations where uv may have failed silently.
 *
 * @param venv The virtual environment to validate
 * @param importsToCheck Array of Python module names to check
 * @param callbacks Optional callbacks for output handling
 * @returns Validation result indicating success or list of missing imports
 */
export async function validateVirtualEnvironment(
  venv: VirtualEnvironment,
  importsToCheck: string[],
  callbacks?: ProcessCallbacks
): Promise<VenvValidationResult> {
  if (importsToCheck.length === 0) {
    return { success: true };
  }

  log.info(`Validating virtual environment - testing ${importsToCheck.length} imports`);

  let output = '';

  const cb = (data: string) => (output += data);

  const processCallbacks =
    callbacks ??
    ({
      onStdout: cb,
      onStderr: cb,
    } satisfies ProcessCallbacks);

  try {
    const testScript = generateImportTestScript(importsToCheck);
    const { exitCode } = await venv.runPythonCommandAsync(['-c', testScript], processCallbacks);

    // Try to parse the JSON output
    try {
      const result = JSON.parse(output) as {
        success: boolean;
        failed_imports: string[];
      };

      if (result.success) {
        log.info('Virtual environment validation successful - all imports available');
        return { success: true };
      }

      const failedImports = result.failed_imports || [];
      log.error(`Virtual environment validation failed - missing imports: ${failedImports.join(', ')}`);
      return {
        success: false,
        missingImports: failedImports,
        error: `Missing imports: ${failedImports.join(', ')}`,
      };
    } catch {
      // If we can't parse the output, return a generic error
      log.error('Failed to parse validation output:', output);
      return {
        success: false,
        error: `Python validation failed with exit code ${exitCode}: ${output}`,
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
