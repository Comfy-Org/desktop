import { ipcMain } from 'electron';
import log from 'electron-log/main';

import { IPC_CHANNELS } from '@/constants';
import type { AppWindow } from '@/main-process/appWindow';
import type { ComfyInstallation } from '@/main-process/comfyInstallation';
import type { InstallValidation } from '@/preload';
import { getTelemetry } from '@/services/telemetry';

/**
 * IPC handler for troubleshooting / maintenance tasks.
 *
 * Should be disposed when navigating away from the page.
 */
export class Troubleshooting implements Disposable {
  readonly #handlers: ((data: InstallValidation) => unknown)[] = [];

  constructor(
    private readonly installation: ComfyInstallation,
    private readonly appWindow: AppWindow
  ) {
    this.#setOnUpdateCallback();
    this.#addIpcHandlers();
  }

  addOnUpdateHandler(handler: (data: InstallValidation) => unknown) {
    this.#handlers.push(handler);
  }

  #setOnUpdateCallback() {
    this.installation.onUpdate = (data) => {
      this.appWindow.send(IPC_CHANNELS.VALIDATION_UPDATE, data);

      for (const handler of this.#handlers) {
        handler(data);
      }
    };
  }

  /** Creates IPC handlers for the installation instance. */
  #addIpcHandlers() {
    const { installation } = this;
    const sendLogIpc = (data: string) => {
      log.info(data);
      this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
    };

    ipcMain.handle(IPC_CHANNELS.GET_VALIDATION_STATE, () => {
      installation.onUpdate?.(installation.validation);
      return installation.validation;
    });
    ipcMain.handle(IPC_CHANNELS.VALIDATE_INSTALLATION, async () => {
      getTelemetry().track('installation_manager:installation_validate');
      return await installation.validate();
    });
    ipcMain.handle(IPC_CHANNELS.UV_INSTALL_REQUIREMENTS, () => {
      getTelemetry().track('installation_manager:uv_requirements_install');
      return installation.virtualEnvironment.reinstallRequirements(sendLogIpc);
    });
    ipcMain.handle(IPC_CHANNELS.UV_CLEAR_CACHE, async () => {
      getTelemetry().track('installation_manager:uv_cache_clear');
      return await installation.virtualEnvironment.clearUvCache(sendLogIpc);
    });
    ipcMain.handle(IPC_CHANNELS.UV_RESET_VENV, async (): Promise<boolean> => {
      getTelemetry().track('installation_manager:uv_venv_reset');
      const venv = installation.virtualEnvironment;
      const deleted = await venv.removeVenvDirectory();
      if (!deleted) return false;

      const created = await venv.createVenv(sendLogIpc);
      if (!created) return false;

      return await venv.upgradePip({ onStdout: sendLogIpc, onStderr: sendLogIpc });
    });
  }

  /** Removes all handlers created by {@link #setupIpc} */
  #removeIpcHandlers() {
    ipcMain.removeHandler(IPC_CHANNELS.GET_VALIDATION_STATE);
    ipcMain.removeHandler(IPC_CHANNELS.VALIDATE_INSTALLATION);
    ipcMain.removeHandler(IPC_CHANNELS.UV_INSTALL_REQUIREMENTS);
    ipcMain.removeHandler(IPC_CHANNELS.UV_CLEAR_CACHE);
    ipcMain.removeHandler(IPC_CHANNELS.UV_RESET_VENV);
  }

  [Symbol.dispose](): void {
    delete this.installation.onUpdate;
    this.#removeIpcHandlers();
  }
}
