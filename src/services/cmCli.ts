import { getAppResourcesPath } from '../install/resourcePaths';
import { ProcessCallbacks, VirtualEnvironment } from '../virtualEnvironment';
import { trackEvent, HasTelemetry, ITelemetry } from './telemetry';
import log from 'electron-log/main';
import path from 'node:path';
import { fileSync } from 'tmp';

export class CmCli implements HasTelemetry {
  private cliPath: string;
  private virtualEnvironment: VirtualEnvironment;

  constructor(
    virtualEnvironment: VirtualEnvironment,
    readonly telemetry: ITelemetry
  ) {
    this.virtualEnvironment = virtualEnvironment;
    this.cliPath = path.join(getAppResourcesPath(), 'ComfyUI', 'custom_nodes', 'ComfyUI-Manager', 'cm-cli.py');
  }

  private async _runCommandAsync(
    args: string[],
    callbacks?: ProcessCallbacks,
    env?: Record<string, string>,
    cwd?: string
  ): Promise<{ exitCode: number | null }> {
    const cmd = [this.cliPath, ...args];
    return await this.virtualEnvironment.runPythonCommandAsync(cmd, callbacks, env, cwd);
  }

  public async runCommandAsync(
    args: string[],
    callbacks?: ProcessCallbacks,
    env: Record<string, string> = {},
    checkExit: boolean = true,
    cwd?: string
  ) {
    let output = '';
    let error = '';
    const { exitCode } = await this._runCommandAsync(
      args,
      {
        onStdout: (message) => {
          output += message;
          callbacks?.onStdout?.(message);
        },
        onStderr: (message) => {
          console.warn('[warn]', message);
          error += message;
          callbacks?.onStderr?.(message);
        },
      },
      {
        COMFYUI_PATH: this.virtualEnvironment.venvRootPath,
        ...env,
      },
      cwd
    );

    if (checkExit && exitCode !== 0) {
      throw new Error(`Error calling cm-cli: \nExit code: ${exitCode}\nOutput:${output}\n\nError:${error}`);
    }

    return output;
  }

  @trackEvent('migrate_flow:migrate_custom_nodes')
  public async restoreCustomNodes(fromComfyDir: string, callbacks: ProcessCallbacks) {
    const tmpFile = fileSync({ postfix: '.json' });
    try {
      log.debug('Using temp file: ' + tmpFile.name);
      await this.saveSnapshot(fromComfyDir, tmpFile.name, callbacks);
      await this.restoreSnapshot(tmpFile.name, callbacks);
    } finally {
      tmpFile?.removeCallback();
    }
  }

  public async saveSnapshot(fromComfyDir: string, outFile: string, callbacks: ProcessCallbacks): Promise<void> {
    const output = await this.runCommandAsync(
      ['save-snapshot', '--output', outFile, '--no-full-snapshot'],
      callbacks,
      {
        COMFYUI_PATH: fromComfyDir,
        PYTHONPATH: fromComfyDir,
      },
      true,
      fromComfyDir
    );
    log.info(output);
  }

  public async restoreSnapshot(snapshotFile: string, callbacks: ProcessCallbacks) {
    log.info('Restoring snapshot ' + snapshotFile);
    const output = await this.runCommandAsync(['restore-snapshot', snapshotFile], callbacks);
    log.info(output);
  }
}
