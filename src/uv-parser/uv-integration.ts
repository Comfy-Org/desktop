/**
 * UV Integration Module
 *
 * Integrates UV state management with virtual environment operations.
 * Provides helper functions to track UV process output.
 */
import log from 'electron-log/main';

import { useAppState } from '@/main-process/appState';
import type { ProcessCallbacks } from '@/virtualEnvironment';

import type { UVParsedOutput } from './types.js';
import type { IUVState, UVProcessId, UVProcessType } from './uv-state-interfaces.js';

/**
 * Create process callbacks that integrate with UV state
 */
export function createUVProcessCallbacks(
  processType: UVProcessType,
  onData?: (data: string) => void,
  processId?: UVProcessId
): {
  callbacks: ProcessCallbacks;
  processId: UVProcessId;
} {
  const uvState = useAppState().uvState;

  // Start a new UV process
  const process = uvState.startProcess({
    type: processType,
    id: processId,
    storeRawOutput: false,
    maxParsedOutputs: 500,
    emitAllOutputs: false,
  });

  const callbacks: ProcessCallbacks = {
    onStdout: (data: string) => {
      // Forward to original callback if provided
      if (onData) {
        onData(data);
      }

      // Process each line through UV state
      const lines = data.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const output = uvState.processLine(process.id, line);

            // Log important events
            if (output) {
              logParsedOutput(output);
            }
          } catch (error) {
            log.error('Error processing UV output line:', error);
          }
        }
      }
    },
    onStderr: (data: string) => {
      // Log stderr
      log.warn('UV stderr:', data);

      // Forward to original callback if provided
      if (onData) {
        onData(data);
      }
    },
  };

  return {
    callbacks,
    processId: process.id,
  };
}

/**
 * Complete a UV process successfully
 */
export function completeUVProcess(processId: UVProcessId): void {
  const uvState = useAppState().uvState;
  uvState.completeProcess(processId);
}

/**
 * Fail a UV process with an error
 */
export function failUVProcess(processId: UVProcessId, error: Error): void {
  const uvState = useAppState().uvState;
  uvState.failProcess(processId, error);
}

/**
 * Cancel a UV process
 */
export function cancelUVProcess(processId: UVProcessId): void {
  const uvState = useAppState().uvState;
  uvState.cancelProcess(processId);
}

/**
 * Get UV state instance
 */
export function getUVStateFromApp(): IUVState {
  return useAppState().uvState;
}

/**
 * Log important parsed output
 */
function logParsedOutput(output: UVParsedOutput): void {
  switch (output.type) {
    case 'resolution_summary':
      log.info(`UV: Resolved ${output.packageCount} packages in ${output.duration}`);
      break;

    case 'preparation_summary':
      log.info(`UV: Prepared ${output.packageCount} packages in ${output.duration}`);
      break;

    case 'installation_summary':
      log.info(`UV: Installed ${output.packageCount} packages in ${output.duration}`);
      break;

    case 'error':
      log.error(`UV Error: ${output.message}`);
      break;

    case 'warning':
      log.warn(`UV Warning: ${output.message}`);
      break;

    case 'download_progress':
      if (output.state === 'started') {
        log.debug(`UV: Downloading ${output.package.name} ${output.package.size || ''}`);
      }
      break;

    case 'changed_package':
      log.debug(`UV: ${output.operation} ${output.package.specification}`);
      break;
  }
}

/**
 * Hook to track UV installations in virtual environment
 */
/**
 * Wrap the installRequirements method to track UV state
 */
export function wrapInstallRequirements(
  originalMethod: (callbacks?: ProcessCallbacks) => Promise<void>,
  context: unknown,
  processType: UVProcessType = 'core_requirements'
): (callbacks?: ProcessCallbacks) => Promise<void> {
  return async function (callbacks?: ProcessCallbacks) {
    const { callbacks: uvCallbacks, processId } = createUVProcessCallbacks(processType, callbacks?.onStdout);

    try {
      // Call original method with UV-enhanced callbacks
      await originalMethod.call(context, uvCallbacks);

      // Mark process as complete
      completeUVProcess(processId);
    } catch (error) {
      // Mark process as failed
      failUVProcess(processId, error as Error);
      throw error;
    }
  };
}

/**
 * Wrap any UV pip install command
 */
export function wrapUVCommand<T>(
  command: () => Promise<T>,
  processType: UVProcessType,
  onData?: (data: string) => void
): Promise<T> {
  const { processId } = createUVProcessCallbacks(processType, onData);

  return command()
    .then((result) => {
      completeUVProcess(processId);
      return result;
    })
    .catch((error: unknown) => {
      failUVProcess(processId, error as Error);
      throw error;
    });
}
