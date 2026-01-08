import { Notification, app, dialog, shell } from 'electron';
import log from 'electron-log/main';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { strictIpcMain as ipcMain } from '@/infrastructure/ipcChannels';

import { IPC_CHANNELS, InstallStage, ProgressStatus } from '../constants';
import { PythonImportVerificationError } from '../infrastructure/pythonImportVerificationError';
import { useAppState } from '../main-process/appState';
import type { AppWindow } from '../main-process/appWindow';
import { ComfyInstallation } from '../main-process/comfyInstallation';
import { createInstallStageInfo } from '../main-process/installStages';
import type { InstallOptions, InstallValidation } from '../preload';
import { CmCli } from '../services/cmCli';
import { captureSentryException } from '../services/sentry';
import { type HasTelemetry, ITelemetry, trackEvent } from '../services/telemetry';
import { type DesktopConfig, useDesktopConfig } from '../store/desktopConfig';
import { canExecuteShellCommand, compareVersions, validateHardware } from '../utils';
import type { ProcessCallbacks, VirtualEnvironment } from '../virtualEnvironment';
import { createProcessCallbacks } from './createProcessCallbacks';
import { InstallWizard } from './installWizard';
import { Troubleshooting } from './troubleshooting';

const execAsync = promisify(exec);
const NVIDIA_DRIVER_MIN_VERSION = '580';

/**
 * Extracts the NVIDIA driver version from `nvidia-smi` output.
 * @param output The `nvidia-smi` output to parse.
 * @returns The driver version, if present.
 */
export function parseNvidiaDriverVersionFromSmiOutput(output: string): string | undefined {
  const match = output.match(/driver version\s*:\s*([\d.]+)/i);
  return match?.[1];
}

/** High-level / UI control over the installation of ComfyUI server. */
export class InstallationManager implements HasTelemetry {
  constructor(
    readonly appWindow: AppWindow,
    readonly telemetry: ITelemetry
  ) {}

  /**
   * Ensures that ComfyUI is installed and ready to run.
   *
   * First checks for an existing installation and validates it. If missing or invalid, a fresh install is started.
   * Will not resolve until the installation is valid.
   * @returns A valid {@link ComfyInstallation} object.
   */
  async ensureInstalled(): Promise<ComfyInstallation> {
    const installation = await ComfyInstallation.fromConfig();
    log.info(`Install state: ${installation?.state ?? 'not installed'}`);

    // Fresh install
    if (!installation) return await this.freshInstall();

    // Resume installation
    if (installation.state === 'started') return await this.resumeInstallation();

    // Replace the reinstall IPC handler.
    InstallationManager.setReinstallHandler(installation);

    // Validate the installation
    return await this.validateInstallation(installation);
  }

  private async validateInstallation(installation: ComfyInstallation) {
    this.#onMaintenancePage = false;

    // Send updates to renderer
    using troubleshooting = new Troubleshooting(installation, this.appWindow);
    troubleshooting.addOnUpdateHandler((data) => this.#onUpdateHandler(data));

    // Determine actual install state
    const state = await installation.validate();

    // Convert from old format
    if (state === 'upgraded') installation.upgradeConfig();

    // Install updated manager requirements
    if (installation.needsRequirementsUpdate) await this.updatePackages(installation);

    // Resolve issues and re-run validation
    if (installation.hasIssues) {
      while (!(await this.resolveIssues(installation, troubleshooting))) {
        // Re-run validation
        log.verbose('Re-validating installation.');
      }
    }

    // Return validated installation
    return installation;
  }

  /** Set to `true` the first time an error is found during validation. @todo Move to app state singleton once impl. */
  #onMaintenancePage = false;

  #onUpdateHandler(data: InstallValidation) {
    if (this.#onMaintenancePage || !Object.values(data).includes('error')) return;

    // Load maintenance page the first time any error is found.
    this.#onMaintenancePage = true;
    const error = Object.entries(data).find(([, value]) => value === 'error')?.[0];
    this.telemetry.track('validation:error_found', { error });

    log.info('Validation error - loading maintenance page.');
    const appState = useAppState();
    appState.setInstallStage(
      createInstallStageInfo(InstallStage.MAINTENANCE_MODE, { progress: 90, message: `Validation error: ${error}` })
    );
    this.appWindow.loadPage('maintenance').catch((error) => {
      log.error('Error loading maintenance page.', error);
      const message = `An error was detected with your installation, and the maintenance page could not be loaded to resolve it. The app will close now. Please reinstall if this issue persists.\n\nError message:\n\n${error}`;
      dialog.showErrorBox('Critical Error', message);
      app.quit();
    });
  }

  /**
   * Resumes an installation that was never completed.
   */
  async resumeInstallation(): Promise<ComfyInstallation> {
    log.verbose('Resuming installation.');
    // TODO: Resume install at point of interruption
    return await this.freshInstall();
  }

  /**
   * Install ComfyUI and return the base path.
   */
  async freshInstall(): Promise<ComfyInstallation> {
    log.info('Starting installation.');
    const config = useDesktopConfig();
    const appState = useAppState();
    config.set('installState', 'started');

    // Check available GPU
    appState.setInstallStage(createInstallStageInfo(InstallStage.HARDWARE_VALIDATION, { progress: 3 }));
    const hardware = await validateHardware();
    if (typeof hardware.gpu === 'string') config.set('detectedGpu', hardware.gpu);

    /** Resovles when the user has confirmed all install options */
    const optionsPromise = new Promise<InstallOptions>((resolve) => {
      ipcMain.once(IPC_CHANNELS.INSTALL_COMFYUI, (_event, installOptions: InstallOptions) => {
        log.verbose('Received INSTALL_COMFYUI.');
        resolve(installOptions);
      });
    });

    // Load the welcome page / unsupported hardware page
    if (!hardware.isValid) {
      log.error(hardware.error);
      log.verbose('Loading not-supported renderer.');
      this.telemetry.track('desktop:hardware_not_supported');
      await this.appWindow.loadPage('not-supported');
    } else {
      log.verbose('Loading welcome renderer.');
      appState.setInstallStage(createInstallStageInfo(InstallStage.WELCOME_SCREEN, { progress: 4 }));
      await this.appWindow.loadPage('welcome');
    }

    // Check if git is installed
    log.verbose('Checking if git is installed.');
    appState.setInstallStage(createInstallStageInfo(InstallStage.GIT_CHECK, { progress: 5 }));
    const gitInstalled = await canExecuteShellCommand('git --version');
    if (!gitInstalled) {
      log.verbose('git not detected in path, loading download-git page.');

      const { response } = await this.appWindow.showMessageBox({
        type: 'info',
        title: 'Download git',
        message: `We were unable to find git on this device.\n\nPlease download and install git before continuing with the installation of ComfyUI Desktop.`,
        buttons: ['Open git downloads page', 'Skip'],
        defaultId: 0,
        cancelId: 1,
      });

      if (response === 0) {
        await shell.openExternal('https://git-scm.com/downloads/');
      }
    }

    // Handover to frontend
    appState.setInstallStage(createInstallStageInfo(InstallStage.INSTALL_OPTIONS_SELECTION, { progress: 6 }));
    const installOptions = await optionsPromise;
    this.telemetry.track('desktop:install_options_received', {
      gpuType: installOptions.device,
      autoUpdate: installOptions.autoUpdate,
      allowMetrics: installOptions.allowMetrics,
      migrationItemIds: installOptions.migrationItemIds,
      pythonMirror: installOptions.pythonMirror,
      pypiMirror: installOptions.pypiMirror,
      torchMirror: installOptions.torchMirror,
      device: installOptions.device,
    });

    // Save desktop config
    const { device } = installOptions;
    useDesktopConfig().set('basePath', installOptions.installPath);
    useDesktopConfig().set('versionConsentedMetrics', __COMFYUI_DESKTOP_VERSION__);
    useDesktopConfig().set('selectedDevice', device);

    // Load the next page
    const page = device === 'unsupported' ? 'not-supported' : 'server-start';
    if (!this.appWindow.isOnPage(page)) {
      await this.appWindow.loadPage(page);
    }

    // Creates folders and initializes ComfyUI settings
    appState.setInstallStage(createInstallStageInfo(InstallStage.CREATING_DIRECTORIES, { progress: 8 }));
    const installWizard = new InstallWizard(installOptions, this.telemetry);
    await installWizard.install();

    const shouldMigrateCustomNodes =
      !!installWizard.migrationSource && installWizard.migrationItemIds.has('custom_nodes');
    if (shouldMigrateCustomNodes) {
      useDesktopConfig().set('migrateCustomNodesFrom', installWizard.migrationSource);
    }

    const installation = new ComfyInstallation('started', installWizard.basePath, this.telemetry);
    InstallationManager.setReinstallHandler(installation);
    const { virtualEnvironment } = installation;

    // Virtual terminal output callbacks
    const processCallbacks = createProcessCallbacks(this.appWindow);

    // Create virtual environment
    appState.setInstallStage(createInstallStageInfo(InstallStage.PYTHON_ENVIRONMENT_SETUP, { progress: 15 }));
    this.appWindow.sendServerStartProgress(ProgressStatus.PYTHON_SETUP);

    try {
      await virtualEnvironment.create(processCallbacks);
    } catch (error) {
      if (error instanceof PythonImportVerificationError) {
        // Show dialog to user asking if they want to reinstall
        const result = await this.appWindow.showMessageBox({
          type: 'warning',
          title: 'Python Environment Issue',
          message: `${error.message} Would you like to remove your .venv directory and reinstall it?`,
          buttons: ['Reinstall venv', 'Ignore'],
          defaultId: 0,
          cancelId: 1,
        });

        if (result.response === 1) {
          // User chose to ignore the issue
          log.warn('User chose to ignore python import verification failure');
          this.telemetry.track('install_flow:virtual_environment_create_error', { reason: 'ignore_venv_issues' });
        } else {
          // User chose to reinstall - remove venv and retry
          log.info('User chose to reinstall venv after import verification failure');
          await virtualEnvironment.removeVenvDirectory();
          await virtualEnvironment.create(processCallbacks);
        }
      } else {
        // Send error to Sentry
        const errorEventName = 'install_flow:virtual_environment_create_fatal';
        const sentryUrl = captureSentryException(
          error instanceof Error ? error : new Error(String(error)),
          errorEventName
        );

        // Log the error
        log.error('Fatal error creating virtual environment:', error);
        this.telemetry.track(errorEventName, {
          error_name: error instanceof Error ? error.name : 'UnknownError',
          error_type: error instanceof Error ? error.constructor.name : typeof error,
          error_message: error instanceof Error ? error.message : 'Unknown error occurred',
          sentry_url: sentryUrl,
        });

        // Show friendly error dialog with documentation link
        const errorMessage = error instanceof Error ? error.message : String(error);
        const result = await dialog.showMessageBox({
          type: 'error',
          title: 'Virtual Environment Creation Failed',
          message: 'Failed to create virtual environment',
          detail: `ComfyUI Desktop was unable to set up the Python environment required to run.\n\nError details:\n${errorMessage}\n\nWould you like to view the documentation for help with this issue?`,
          buttons: ['View Documentation', 'Exit'],
          defaultId: 0,
          cancelId: 1,
        });

        // Open documentation if user clicked "View Documentation"
        if (result.response === 0) {
          await shell.openExternal('https://docs.comfy.org');
        }

        // Exit gracefully
        app.exit(3001);
      }
    }

    // Migrate custom nodes
    if (shouldMigrateCustomNodes) {
      appState.setInstallStage(createInstallStageInfo(InstallStage.MIGRATING_CUSTOM_NODES, { progress: 75 }));
    }
    const customNodeMigrationError = await this.migrateCustomNodes(config, virtualEnvironment, processCallbacks);
    if (customNodeMigrationError) {
      // TODO: Replace with IPC callback to handle i18n (SoC).
      new Notification({
        title: 'Failed to migrate custom nodes',
        body: customNodeMigrationError,
      }).show();
    }

    installation.setState('installed');
    return installation;
  }

  /** @returns `undefined` if successful, or an error `string` on failure. */
  async migrateCustomNodes(config: DesktopConfig, virtualEnvironment: VirtualEnvironment, callbacks: ProcessCallbacks) {
    const fromPath = config.get('migrateCustomNodesFrom');
    if (!fromPath) return;

    log.info('Migrating custom nodes from:', fromPath);
    try {
      const cmCli = new CmCli(virtualEnvironment, virtualEnvironment.telemetry);
      await cmCli.restoreCustomNodes(fromPath, callbacks);
    } catch (error) {
      log.error('Error migrating custom nodes:', error);
      // TODO: Replace with IPC callback to handle i18n (SoC).
      return error?.toString?.() ?? 'Error migrating custom nodes.';
    } finally {
      // Always remove the flag so the user doesnt get stuck here
      config.delete('migrateCustomNodesFrom');
    }
  }

  /**
   * Resolves any issues found during installation validation.
   * @param installation The installation to resolve issues for
   * @throws If the base path is invalid or cannot be saved
   */
  async resolveIssues(installation: ComfyInstallation, troubleshooting: Troubleshooting) {
    log.verbose('Resolving issues - awaiting user response:', installation.validation);

    // Await user close window request, validate if any errors remain
    const isValid = await new Promise<boolean>((resolve) => {
      const onInstallFix = async (): Promise<boolean> => {
        log.verbose('Attempting to close validation window');
        // Check if issues have been resolved externally
        if (!installation.isValid) await installation.validate();

        // Resolve main thread & renderer
        const { isValid } = installation;
        resolve(isValid);
        return isValid;
      };

      troubleshooting.onInstallFix = onInstallFix;
      ipcMain.handleOnce(IPC_CHANNELS.COMPLETE_VALIDATION, onInstallFix);
    });
    // Handler is only called (and removed) when manually clicking the continue button.
    ipcMain.removeHandler(IPC_CHANNELS.COMPLETE_VALIDATION);

    log.verbose('Resolution complete:', installation.validation);
    return isValid;
  }

  @trackEvent('installation_manager:manager_packages_update')
  private async updatePackages(installation: ComfyInstallation) {
    await this.appWindow.loadPage('desktop-update');

    // Using requirements.txt again here ensures that uv installs the expected packages from the previous step (--dry-run)
    const callbacks = createProcessCallbacks(this.appWindow, { logStderrAsInfo: true });
    try {
      await installation.virtualEnvironment.installComfyUIRequirements(callbacks);
      await installation.virtualEnvironment.installComfyUIManagerRequirements(callbacks);
      await this.warnIfNvidiaDriverTooOld(installation);
      await installation.virtualEnvironment.ensureRecommendedNvidiaTorch(callbacks);
      await installation.validate();
    } catch (error) {
      log.error('Error auto-updating packages:', error);
      await this.appWindow.loadPage('server-start');
    }
  }

  /**
   * Warns the user if their NVIDIA driver is too old for the required CUDA build.
   * @param installation The current installation.
   */
  private async warnIfNvidiaDriverTooOld(installation: ComfyInstallation): Promise<void> {
    if (process.platform !== 'win32') return;
    if (installation.virtualEnvironment.selectedDevice !== 'nvidia') return;

    const driverVersion =
      (await this.getNvidiaDriverVersionFromSmi()) ?? (await this.getNvidiaDriverVersionFromSmiFallback());
    if (!driverVersion) return;

    if (compareVersions(driverVersion, NVIDIA_DRIVER_MIN_VERSION) >= 0) return;

    await this.appWindow.showMessageBox({
      type: 'warning',
      title: 'Update NVIDIA Driver',
      message: 'Your NVIDIA driver is too old for PyTorch 2.9.1 + cu130.',
      detail: `Detected driver version: ${driverVersion}\nMinimum required: ${NVIDIA_DRIVER_MIN_VERSION}\n\nPlease update your NVIDIA drivers and retry.`,
      buttons: ['OK'],
    });
  }

  /**
   * Reads the NVIDIA driver version from nvidia-smi query output.
   */
  private async getNvidiaDriverVersionFromSmi(): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('nvidia-smi --query-gpu=driver_version --format=csv,noheader');
      const version = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      return version || undefined;
    } catch (error) {
      log.debug('Failed to read NVIDIA driver version via nvidia-smi query.', error);
      return undefined;
    }
  }

  /**
   * Reads the NVIDIA driver version from nvidia-smi standard output.
   */
  private async getNvidiaDriverVersionFromSmiFallback(): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('nvidia-smi');
      return parseNvidiaDriverVersionFromSmiOutput(stdout);
    } catch (error) {
      log.debug('Failed to read NVIDIA driver version via nvidia-smi output.', error);
      return undefined;
    }
  }

  static setReinstallHandler(installation: ComfyInstallation) {
    ipcMain.removeHandler(IPC_CHANNELS.REINSTALL);
    ipcMain.handle(IPC_CHANNELS.REINSTALL, async () => await InstallationManager.reinstall(installation));
  }

  private static async reinstall(installation: ComfyInstallation): Promise<void> {
    log.info('Reinstalling...');
    await installation.uninstall();
    app.relaunch();
    app.quit();
  }
}
