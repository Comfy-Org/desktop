import { app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';

import { IPC_CHANNELS } from '../constants';
import type { AppWindow } from '../main-process/appWindow';
import { ComfyInstallation } from '../main-process/comfyInstallation';
import type { InstallOptions } from '../preload';
import { ITelemetry } from '../services/telemetry';
import { useDesktopConfig } from '../store/desktopConfig';
import { validateHardware } from '../utils';
import { InstallWizard } from './installWizard';

/** High-level / UI control over the installation of ComfyUI server. */
export class InstallationManager {
  private _isFreshInstall = false;

  constructor(
    public readonly appWindow: AppWindow,
    private readonly telemetry: ITelemetry
  ) {}

  get isFreshInstall(): boolean {
    return this._isFreshInstall;
  }

  /**
   * Ensures that ComfyUI is installed and ready to run.
   *
   * First checks for an existing installation and validates it. If missing or invalid, a fresh install is started.
   * Will not resolve until the installation is valid.
   * @returns A valid {@link ComfyInstallation} object.
   */
  async ensureInstalled(): Promise<ComfyInstallation> {
    const installation = ComfyInstallation.fromConfig();
    log.info(`Install state: ${installation?.state ?? 'not installed'}`);

    // Fresh install
    if (!installation) {
      this._isFreshInstall = true;
      return await this.freshInstall();
    }

    try {
      // Send updates to renderer
      this.#setupIpc(installation);

      // Validate installation
      const state = await installation.validate();
      if (state !== 'installed') await this.resumeInstallation(installation);

      // Resolve issues and re-run validation
      if (installation.hasIssues) {
        while (!(await this.resolveIssues(installation))) {
          // Re-run validation
          log.verbose('Re-validating installation.');
        }
      }

      // Return validated installation
      return installation;
    } finally {
      delete installation.onUpdate;
      this.#removeIpcHandlers();
    }
  }

  /** Removes all handlers created by {@link #setupIpc} */
  #removeIpcHandlers() {
    ipcMain.removeHandler(IPC_CHANNELS.GET_VALIDATION_STATE);
    ipcMain.removeHandler(IPC_CHANNELS.VALIDATE_INSTALLATION);
    ipcMain.removeHandler(IPC_CHANNELS.UV_INSTALL_REQUIREMENTS);
    ipcMain.removeHandler(IPC_CHANNELS.UV_CLEAR_CACHE);
    ipcMain.removeHandler(IPC_CHANNELS.UV_RESET_VENV);
  }

  /** Set to `true` the first time an error is found during validation. @todo Move to app state singleton once impl. */
  #onMaintenancePage = false;

  /** Creates IPC handlers for the installation instance. */
  #setupIpc(installation: ComfyInstallation) {
    this.#onMaintenancePage = false;
    installation.onUpdate = (data) => {
      this.appWindow.send(IPC_CHANNELS.VALIDATION_UPDATE, data);

      // Load maintenance page the first time any error is found.
      if (!this.#onMaintenancePage && Object.values(data).includes('error')) {
        this.#onMaintenancePage = true;
        const error = Object.entries(data).find(([, value]) => value === 'error')?.[0];
        this.telemetry.track('validation:error_found', { error });

        log.info('Validation error - loading maintenance page.');
        this.appWindow.loadRenderer('maintenance').catch((error) => {
          log.error('Error loading maintenance page.', error);
          const message = `An error was detected with your installation, and the maintenance page could not be loaded to resolve it. The app will close now. Please reinstall if this issue persists.\n\nError message:\n\n${error}`;
          dialog.showErrorBox('Critical Error', message);
          app.quit();
        });
      }
    };
    const sendLogIpc = (data: string) => this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);

    ipcMain.handle(IPC_CHANNELS.GET_VALIDATION_STATE, () => {
      installation.onUpdate?.(installation.validation);
      return installation.validation;
    });
    ipcMain.handle(IPC_CHANNELS.VALIDATE_INSTALLATION, async () => await installation.validate());
    ipcMain.handle(IPC_CHANNELS.UV_INSTALL_REQUIREMENTS, () =>
      installation.virtualEnvironment.reinstallRequirements(sendLogIpc)
    );
    ipcMain.handle(IPC_CHANNELS.UV_CLEAR_CACHE, async () => await installation.virtualEnvironment.clearUvCache());
    ipcMain.handle(IPC_CHANNELS.UV_RESET_VENV, async (): Promise<boolean> => {
      const venv = installation.virtualEnvironment;
      const deleted = await venv.removeVenvDirectory();
      if (!deleted) return false;

      const created = await venv.createVenv(sendLogIpc);
      if (!created) return false;

      return await venv.upgradePip({ onStdout: sendLogIpc, onStderr: sendLogIpc });
    });

    // Replace the reinstall IPC handler.
    ipcMain.removeHandler(IPC_CHANNELS.REINSTALL);
    ipcMain.handle(IPC_CHANNELS.REINSTALL, async () => {
      log.info('Reinstalling...');
      await InstallationManager.reinstall(installation);
    });
  }

  /**
   * Resumes an installation that was never completed.
   * @param installation The installation to resume
   */
  async resumeInstallation(installation: ComfyInstallation) {
    log.verbose('Resuming installation.');
    // TODO: Resume install at point of interruption
    if (installation.state === 'started') {
      await this.freshInstall();
      installation.setState('installed');
    }
    if (installation.state === 'upgraded') installation.upgradeConfig();
  }

  /**
   * Install ComfyUI and return the base path.
   */
  async freshInstall(): Promise<ComfyInstallation> {
    log.info('Starting installation.');
    const config = useDesktopConfig();
    config.set('installState', 'started');

    const hardware = await validateHardware();
    if (typeof hardware?.gpu === 'string') config.set('detectedGpu', hardware.gpu);

    const optionsPromise = new Promise<InstallOptions>((resolve) => {
      ipcMain.once(IPC_CHANNELS.INSTALL_COMFYUI, (_event, installOptions: InstallOptions) => {
        log.verbose('Received INSTALL_COMFYUI.');
        resolve(installOptions);
      });
    });

    if (!hardware.isValid) {
      log.error(hardware.error);
      log.verbose('Loading not-supported renderer.');
      this.telemetry.track('desktop:hardware_not_supported');
      await this.appWindow.loadRenderer('not-supported');
    } else {
      log.verbose('Loading welcome renderer.');
      await this.appWindow.loadRenderer('welcome');
    }

    const installOptions = await optionsPromise;
    this.telemetry.track('desktop:install_options_received', {
      gpuType: installOptions.device,
      autoUpdate: installOptions.autoUpdate,
      allowMetrics: installOptions.allowMetrics,
      migrationItemIds: installOptions.migrationItemIds,
    });

    const installWizard = new InstallWizard(installOptions, this.telemetry);
    useDesktopConfig().set('basePath', installWizard.basePath);
    useDesktopConfig().set('versionConsentedMetrics', __COMFYUI_DESKTOP_VERSION__);

    const { device } = installOptions;
    if (device !== undefined) {
      useDesktopConfig().set('selectedDevice', device);
    }

    await installWizard.install();
    this.appWindow.maximize();
    const shouldMigrateCustomNodes =
      !!installWizard.migrationSource && installWizard.migrationItemIds.has('custom_nodes');
    if (shouldMigrateCustomNodes) {
      useDesktopConfig().set('migrateCustomNodesFrom', installWizard.migrationSource);
    }

    const installation = new ComfyInstallation('installed', installWizard.basePath, this.telemetry, device);
    installation.setState('installed');
    return installation;
  }

  /**
   * Shows a dialog box to select a base path to install ComfyUI.
   * @param initialPath The initial path to show in the dialog box.
   * @returns The selected path, otherwise `undefined`.
   */
  async showBasePathPicker(initialPath?: string): Promise<string | undefined> {
    const defaultPath = initialPath ?? app.getPath('documents');
    const { filePaths } = await this.appWindow.showOpenDialog({
      defaultPath,
      properties: ['openDirectory', 'treatPackageAsDirectory', 'dontAddToRecent'],
    });
    return filePaths[0];
  }

  /**
   * Resolves any issues found during installation validation.
   * @param installation The installation to resolve issues for
   * @throws If the base path is invalid or cannot be saved
   */
  async resolveIssues(installation: ComfyInstallation) {
    log.verbose('Resolving issues - awaiting user response:', installation.validation);

    // Await user close window request, validate if any errors remain
    const isValid = await new Promise<boolean>((resolve) => {
      ipcMain.handleOnce(IPC_CHANNELS.COMPLETE_VALIDATION, async (): Promise<boolean> => {
        log.verbose('Attempting to close validation window');
        // Check if issues have been resolved externally
        if (!installation.isValid) await installation.validate();

        // Resolve main thread & renderer
        const { isValid } = installation;
        resolve(isValid);
        return isValid;
      });
    });

    log.verbose('Resolution complete:', installation.validation);
    return isValid;
  }

  static async reinstall(installation: ComfyInstallation): Promise<void> {
    await installation.uninstall();
    app.relaunch();
    app.quit();
  }
}
