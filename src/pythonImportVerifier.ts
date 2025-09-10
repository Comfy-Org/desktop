import log from 'electron-log/main';
import Joi from 'joi';

import type { ProcessCallbacks, PythonExecutor } from './virtualEnvironment';

/** Result of Python import verification */
export interface ImportVerificationResult {
  success: boolean;
  error?: string;
  missingImports?: string[];
}

/** List of failed imports reported by the Python script */
interface PythonValidationResult {
  success: boolean;
  failed_imports: string[];
}

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

/** Builds the Joi schema for validating Python script output */
function getPythonVerificationSchema(): Joi.ObjectSchema<PythonValidationResult> {
  return Joi.object<PythonValidationResult>({
    success: Joi.boolean().required(),
    failed_imports: Joi.array().items(Joi.string()).required(),
  });
}

/**
 * Parses and validates the output from the Python import test script.
 * Returns a discriminated union describing the outcome without side effects.
 */
function interpretPythonValidationOutput(
  output: string
):
  | { type: 'parse_error' }
  | { type: 'invalid_format'; message: string }
  | { type: 'ok'; value: PythonValidationResult } {
  try {
    const parsedOutput: unknown = JSON.parse(output);
    const verificationResult = getPythonVerificationSchema().validate(parsedOutput);

    if (verificationResult.error) {
      return { type: 'invalid_format', message: verificationResult.error.message };
    }

    return { type: 'ok', value: verificationResult.value };
  } catch {
    return { type: 'parse_error' };
  }
}

/**
 * Verifies that specified Python packages can be successfully imported.
 * This helps detect partial installations where package managers may have failed silently.
 *
 * @param pythonEnv The virtual environment to use for verification
 * @param importsToCheck Array of Python module names to check
 * @returns Verification result indicating success or list of missing imports
 */
export async function runPythonImportVerifyScript(
  pythonEnv: PythonExecutor,
  importsToCheck: string[]
): Promise<ImportVerificationResult> {
  if (importsToCheck.length === 0) {
    return { success: true };
  }

  log.info(`Verifying Python imports - testing ${importsToCheck.length} modules`);

  let output = '';

  const cb = (data: string) => (output += data);

  const processCallbacks = {
    onStdout: cb,
    onStderr: cb,
  } satisfies ProcessCallbacks;

  try {
    const testScript = generateImportTestScript(importsToCheck);
    const { exitCode } = await pythonEnv.runPythonCommandAsync(['-c', testScript], processCallbacks);

    const interpretation = interpretPythonValidationOutput(output);

    if (interpretation.type === 'parse_error') {
      // If we can't parse the output, return a generic error
      log.error('Failed to parse verification output:', output);
      return {
        success: false,
        error: `Python import verification failed with exit code ${exitCode}: ${output}`,
      };
    }

    if (interpretation.type === 'invalid_format') {
      log.error('Invalid Python output format:', interpretation.message);
      return {
        success: false,
        error: `Invalid verification output format: ${interpretation.message}`,
      };
    }

    const validatedOutput = interpretation.value;
    if (validatedOutput.success) {
      log.info('Python import verification successful - all modules available');
      return { success: true };
    }

    const failedImports = validatedOutput.failed_imports;
    log.error(`Python import verification failed - missing modules: ${failedImports.join(', ')}`);

    return {
      success: false,
      missingImports: failedImports,
      error: `Missing imports: ${failedImports.join(', ')}`,
    };
  } catch (error) {
    log.error('Error during Python import verification:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    };
  }
}
