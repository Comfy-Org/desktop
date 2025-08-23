import { ipcMain } from 'electron';
import log from 'electron-log/main';

import { ComfyServerConfig } from '@/config/comfyServerConfig';
import { IPC_CHANNELS } from '@/constants';
import type { AppWindow } from '@/main-process/appWindow';
import type { ComfyInstallation } from '@/main-process/comfyInstallation';
import type { InstallValidation, UvInstallStatus } from '@/preload';
import { getTelemetry } from '@/services/telemetry';
import { useDesktopConfig } from '@/store/desktopConfig';
import type { UvStatus } from '@/uvLogParser';

/**
 * IPC handler for troubleshooting / maintenance tasks.
 *
 * Should be disposed when navigating away from the page.
 */
export class Troubleshooting implements Disposable {
  readonly #handlers: ((data: InstallValidation) => unknown)[] = [];

  /** Called when an install-fixing task has finished. */
  onInstallFix?: () => Promise<unknown>;

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

    // Get validation state
    ipcMain.handle(IPC_CHANNELS.GET_VALIDATION_STATE, () => {
      installation.onUpdate?.(installation.validation);
      return installation.validation;
    });

    // Validate installation
    ipcMain.handle(IPC_CHANNELS.VALIDATE_INSTALLATION, async () => {
      getTelemetry().track('installation_manager:installation_validate');
      return await installation.validate();
    });

    // Install python packages
    ipcMain.handle(IPC_CHANNELS.UV_INSTALL_REQUIREMENTS, async () => {
      getTelemetry().track('installation_manager:uv_requirements_install');

      // Enhanced callback that tracks installation progress
      const onStatus = (status: UvStatus) => {
        // Only process and send meaningful status updates
        if (status.phase === 'unknown') {
          return; // Skip unknown phases entirely
        }

        // Convert UvStatus to UvInstallStatus for frontend
        const installStatus: UvInstallStatus = {
          phase: status.phase,
          message: status.message,
          totalPackages: status.totalPackages,
          installedPackages: status.installedPackages,
          currentPackage: status.currentPackage,
          error: status.error,
          isComplete: status.phase === 'installed' || (status.phase === 'error' && !!status.error),
        };

        // Log when sending IPC message (not the raw output)
        log.debug(
          `Sending UV IPC status: phase=${status.phase}, package=${status.currentPackage || 'N/A'}, progress=${status.installedPackages || 0}/${status.totalPackages || 0}`
        );

        // Send UV installation status to frontend
        this.appWindow.send(IPC_CHANNELS.UV_INSTALL_STATUS, installStatus);
      };

      // Don't send raw logs when we have UV status parsing
      const logCallback = (data: string) => {
        log.info(data); // Still log to file, but don't send to frontend
      };

      const result = await installation.virtualEnvironment.reinstallRequirements(logCallback, onStatus);

      if (result) await this.onInstallFix?.();
      return result;
    });

    // Clear uv cache
    ipcMain.handle(IPC_CHANNELS.UV_CLEAR_CACHE, async () => {
      getTelemetry().track('installation_manager:uv_cache_clear');
      return await installation.virtualEnvironment.clearUvCache(sendLogIpc);
    });

    // Clear .venv directory
    ipcMain.handle(IPC_CHANNELS.UV_RESET_VENV, async (): Promise<boolean> => {
      getTelemetry().track('installation_manager:uv_venv_reset');
      const venv = installation.virtualEnvironment;
      const deleted = await venv.removeVenvDirectory();
      if (!deleted) return false;

      const created = await venv.createVenv(sendLogIpc);
      if (!created) return false;

      const result = await venv.upgradePip({ onStdout: sendLogIpc, onStderr: sendLogIpc });

      if (result) await this.onInstallFix?.();
      return result;
    });

    // Change base path
    ipcMain.handle(IPC_CHANNELS.SET_BASE_PATH, async (): Promise<boolean> => {
      const currentBasePath = useDesktopConfig().get('basePath');

      const response = await this.appWindow.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath: currentBasePath,
      });
      if (response.canceled || !(response.filePaths.length > 0)) return false;

      const basePath = response.filePaths[0];
      useDesktopConfig().set('basePath', basePath);
      const result = await ComfyServerConfig.setBasePathInDefaultConfig(basePath);

      if (result) await this.onInstallFix?.();
      return result;
    });
  }

  /** Removes all handlers created by {@link #addIpcHandlers} */
  [Symbol.dispose](): void {
    delete this.installation.onUpdate;

    ipcMain.removeHandler(IPC_CHANNELS.GET_VALIDATION_STATE);
    ipcMain.removeHandler(IPC_CHANNELS.VALIDATE_INSTALLATION);
    ipcMain.removeHandler(IPC_CHANNELS.UV_INSTALL_REQUIREMENTS);
    ipcMain.removeHandler(IPC_CHANNELS.UV_CLEAR_CACHE);
    ipcMain.removeHandler(IPC_CHANNELS.UV_RESET_VENV);
    ipcMain.removeHandler(IPC_CHANNELS.SET_BASE_PATH);
  }
}
