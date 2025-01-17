import { app, ipcMain } from 'electron';
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
  constructor(
    public readonly appWindow: AppWindow,
    private readonly telemetry: ITelemetry
  ) {}

  /**
   * Ensures that ComfyUI is installed and ready to run.
   *
   * First checks for an existing installation and validates it. If missing or invalid, a fresh install is started.
   * @returns A valid {@link ComfyInstallation} object.
   */
  async ensureInstalled(): Promise<ComfyInstallation> {
    const installation = ComfyInstallation.fromConfig();
    log.verbose(`Install state: ${installation?.state ?? 'not installed'}`);

    // Fresh install
    if (!installation) return await this.freshInstall();

    // Validate installation
    const state = await installation.validate();
    log.verbose(`Validated install state: ${state}`);
    if (state !== 'installed') await this.resumeInstallation(installation);

    // Resolve issues and re-run validation
    if (installation.issues.size > 0) {
      await this.resolveIssues(installation);
      await installation.validate();
    }

    // TODO: Confirm this is no longer possible after resolveIssues and remove.
    if (!installation.basePath) throw new Error('Base path was invalid after installation validation.');
    if (installation.issues.size > 0) throw new Error('Installation issues remain after validation.');

    // Return validated installation
    return installation;
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

    const installation = new ComfyInstallation('installed', installWizard.basePath, device);
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

  /** Notify user that the provided base apth is not valid. */
  async #showInvalidBasePathMessage() {
    await this.appWindow.showMessageBox({
      title: 'Invalid base path',
      message:
        'ComfyUI needs a valid directory set as its base path.  Inside, models, custom nodes, etc will be stored.\n\nClick OK, then selected a new base path.',
      type: 'error',
    });
  }

  /**
   * Resolves any issues found during installation validation.
   * @param installation The installation to resolve issues for
   * @throws If the base path is invalid or cannot be saved
   */
  async resolveIssues(installation: ComfyInstallation) {
    const issues = [...installation.issues];
    for (const issue of issues) {
      switch (issue) {
        // TODO: Other issues (uv mising, venv etc)
        case 'invalidBasePath': {
          // TODO: Add IPC listeners and proper UI for this
          await this.#showInvalidBasePathMessage();

          const path = await this.showBasePathPicker();
          if (!path) return;

          const success = await installation.updateBasePath(path);
          if (!success) throw new Error('No base path selected or failed to save in config.');

          installation.issues.delete('invalidBasePath');
          break;
        }
      }
    }
  }
}
