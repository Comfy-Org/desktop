import { ComfyServerConfig } from '../config/comfyServerConfig';
import { InstallationValidator } from '../install/installationValidator';
import { useDesktopConfig } from '../store/desktopConfig';
import { pathAccessible, validateHardware } from '../utils';
import type { DesktopSettings } from '../store/desktopSettings';
import type { AppWindow } from './appWindow';
import log from 'electron-log/main';
import { ipcMain } from 'electron';
import type { InstallOptions } from '../preload';
import { IPC_CHANNELS } from '../constants';
import { InstallWizard } from '../install/installWizard';

export type ValidationIssue = 'invalidBasePath';

export interface ValidationResult {
  state: DesktopSettings['installState'];
  readonly issues: ValidationIssue[];
}

/**
 * Object representing the desktop app installation itself.
 * Used to set app state and validate the environment.
 * @todo In progress: Move user interaction to dedicated handlers.
 */
export class ComfyInstallation {
  isValid: boolean = false;
  state?: DesktopSettings['installState'];
  basePath?: string;

  constructor() {
    const config = useDesktopConfig();
    this.state = config.get('installState');
    this.basePath = config.get('basePath') ?? undefined;
  }

  /**
   * Validate the installation and report any issues.
   * @returns The validated installation state, along with a list of any issues detected.
   */
  async validate(): Promise<ValidationResult> {
    log.info(`Validating installation. Recorded state: [${this.state}]`);

    const result: ValidationResult = { state: this.state, issues: [] };

    // Upgraded from a version prior to 0.3.18
    // TODO: Validate more than just the existence of one file
    if (!result.state && ComfyServerConfig.exists()) {
      log.info('Found extra_models_config.yaml but no recorded state - assuming upgrade from <= 0.3.18');
      result.state = 'upgraded';
    }

    // Fresh install
    if (!result.state) {
      log.info('No installation detected.');
      return result;
    }

    // Validate base path
    const basePath = await this.loadBasePath();
    if (basePath === undefined || !(await pathAccessible(basePath))) {
      log.warn('"base_path" is inaccessible or not in config.');
      result.issues.push('invalidBasePath');
    }

    // TODO: Validate python, venv, etc.
    // Set result.state

    if (result.state === 'installed' && result.issues.length === 0) this.isValid = true;
    log.info(`Validation result: isValid:${this.isValid}, state:${result.state}, issues:${result.issues.length}`);
    return result;
  }

  /**
   * Loads the base path from YAML config. If it is unreadable, warns the user and quits.
   * @returns The base path if read successfully, or `undefined`
   */
  async loadBasePath(): Promise<string | undefined> {
    const readResult = await ComfyServerConfig.readBasePathFromConfig(ComfyServerConfig.configPath);
    switch (readResult.status) {
      case 'success':
        // TODO: Check if config.json basePath different, then determine why it has changed (intentional?)
        this.basePath = readResult.path;
        return readResult.path;
      case 'invalid':
        // TODO: File was there, and was valid YAML.  It just didn't have a valid base_path.
        // Show path edit screen instead of reinstall.
        return;
      case 'notFound':
        return;
      default:
        // 'error': Explain and quit
        // TODO: Support link?  Something?
        await new InstallationValidator().showInvalidFileAndQuit(ComfyServerConfig.configPath, {
          message: `Unable to read the YAML configuration file.  Please ensure this file is available and can be read:

${ComfyServerConfig.configPath}

If this problem persists, back up and delete the config file, then restart the app.`,
          buttons: ['Open ComfyUI &directory and quit', '&Quit'],
          defaultId: 0,
          cancelId: 1,
        });
    }
  }

  /**
   * Install ComfyUI and return the base path.
   */
  async startFreshInstall(appWindow: AppWindow): Promise<void> {
    log.info('Starting installation.');

    this.setState('started');
    const config = useDesktopConfig();

    const validation = await validateHardware();
    if (typeof validation?.gpu === 'string') config.set('detectedGpu', validation.gpu);

    if (!validation.isValid) {
      log.verbose('Loading not-supported renderer.');
      await appWindow.loadRenderer('not-supported');
      log.error(validation.error);
    } else {
      log.verbose('Loading welcome renderer.');
      await appWindow.loadRenderer('welcome');
    }

    const installOptions = await new Promise<InstallOptions>((resolve) => {
      ipcMain.on(IPC_CHANNELS.INSTALL_COMFYUI, (_event, installOptions: InstallOptions) => {
        log.verbose('Received INSTALL_COMFYUI.');
        resolve(installOptions);
      });
    });

    const installWizard = new InstallWizard(installOptions);
    useDesktopConfig().set('basePath', installWizard.basePath);

    const { device } = installOptions;
    if (device !== undefined) {
      useDesktopConfig().set('selectedDevice', device);
    }

    await installWizard.install();
    this.setState('installed');
    appWindow.maximize();
    if (installWizard.shouldMigrateCustomNodes && installWizard.migrationSource) {
      useDesktopConfig().set('migrateCustomNodesFrom', installWizard.migrationSource);
    }
    this.isValid = true;
    this.basePath = installWizard.basePath;
  }

  upgrade(validation: ValidationResult) {
    if (!this.basePath || validation.issues.includes('invalidBasePath')) {
      // TODO: Allow user to update base path
    } else {
      const config = useDesktopConfig();
      // Migrate config
      this.setState('installed');
      this.isValid = true;
      config.set('basePath', this.basePath);
    }
  }

  resolveIssues(validation: ValidationResult) {
    for (const issue of validation.issues) {
      switch (issue) {
        // TODO: Other issues (uv mising, venv etc)
        case 'invalidBasePath':
        // TODO: Allow user to update base path
        // TODO: Add IPC listeners
      }
    }
  }

  setState(state: Exclude<DesktopSettings['installState'], undefined>) {
    this.state = state;
    useDesktopConfig().set('installState', state);
  }
}
