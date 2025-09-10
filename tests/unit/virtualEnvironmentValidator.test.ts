import log from 'electron-log/main';
import { describe, expect, test, vi } from 'vitest';

import { runPythonImportVerifyScript } from '@/services/pythonImportVerifier';
import type { ProcessCallbacks, VirtualEnvironment } from '@/virtualEnvironment';

function createMockVenv(
  options: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    throwError?: Error;
  } = {}
) {
  const { stdout = '', stderr = '', exitCode = 0, throwError } = options;

  let capturedArgs: string[] | undefined;

  const venv = {
    runPythonCommandAsync: vi.fn((args: string[], callbacks?: ProcessCallbacks) => {
      capturedArgs = args;
      if (throwError) throw throwError;
      callbacks?.onStdout?.(stdout);
      callbacks?.onStderr?.(stderr);
      return { exitCode };
    }),
  } as unknown as VirtualEnvironment & { runPythonCommandAsync: ReturnType<typeof vi.fn> };

  return { venv, captured: () => capturedArgs };
}

describe('validateVirtualEnvironment', () => {
  test('returns success immediately when no imports provided', async () => {
    const { venv } = createMockVenv();
    const result = await runPythonImportVerifyScript(venv, []);
    expect(result).toEqual({ success: true });
    expect((venv as any).runPythonCommandAsync).not.toHaveBeenCalled();
  });

  test('passes Python -c script with provided imports', async () => {
    const { venv, captured } = createMockVenv({ stdout: JSON.stringify({ failed_imports: [], success: true }) });
    const imports = ['yaml', 'torch', 'uv'];

    const result = await runPythonImportVerifyScript(venv, imports);
    expect(result).toEqual({ success: true });

    const args = captured();
    expect(args).toBeDefined();
    expect(args![0]).toBe('-c');
    expect(typeof args![1]).toBe('string');
    // Ensure the imports list is embedded directly in the Python script
    expect(args![1]).toContain(`for module_name in ${JSON.stringify(imports)}:`);
    expect(log.info).toHaveBeenCalledWith('Python import verification successful - all modules available');
  });

  test('returns missing imports when Python reports failures', async () => {
    const failed = ['toml', 'uv'];
    const { venv } = createMockVenv({ stdout: JSON.stringify({ failed_imports: failed, success: false }) });
    const result = await runPythonImportVerifyScript(venv, ['toml', 'uv', 'yaml']);
    expect(result).toEqual({ success: false, missingImports: failed, error: `Missing imports: ${failed.join(', ')}` });
    expect(log.error).toHaveBeenCalledWith(
      `Python import verification failed - missing modules: ${failed.join(', ')}`
    );
  });

  test('handles invalid JSON format from Python (schema validation failure)', async () => {
    // failed_imports should be an array, not a string
    const invalid = JSON.stringify({ failed_imports: 'not-an-array', success: true });
    const { venv } = createMockVenv({ stdout: invalid });
    const result = await runPythonImportVerifyScript(venv, ['yaml']);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Invalid verification output format:/);
    expect(log.error).toHaveBeenCalledWith('Invalid Python output format:', expect.any(String));
  });

  test('handles parse error when Python outputs non-JSON', async () => {
    const noisy = 'some warning\nnot-json output';
    const { venv } = createMockVenv({ stdout: noisy, exitCode: 1 });
    const result = await runPythonImportVerifyScript(venv, ['yaml']);
    expect(result.success).toBe(false);
    expect(result.error).toContain(`Python import verification failed with exit code 1: ${noisy}`);
    expect(log.error).toHaveBeenCalledWith('Failed to parse verification output:', noisy);
  });

  test('parses JSON from stderr as well as stdout', async () => {
    const json = JSON.stringify({ failed_imports: [], success: true });
    const { venv } = createMockVenv({ stderr: json });
    const result = await runPythonImportVerifyScript(venv, ['yaml']);
    expect(result).toEqual({ success: true });
  });

  test('propagates errors thrown during validation run', async () => {
    const boom = new Error('boom');
    const { venv } = createMockVenv({ throwError: boom });
    const result = await runPythonImportVerifyScript(venv, ['yaml']);
    expect(result).toEqual({ success: false, error: 'boom' });
    expect(log.error).toHaveBeenCalledWith('Error during Python import verification:', boom);
  });
});
