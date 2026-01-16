import log from 'electron-log/main';
import { rm } from 'node:fs/promises';

import { ComfyServerConfig } from '../config/comfyServerConfig';
import { ComfySettings, useComfySettings } from '../config/comfySettings';
import { LEGACY_NVIDIA_TORCH_MIRROR, TorchMirrorUrl } from '../constants';
import { evaluatePathRestrictions } from '../handlers/pathHandlers';
import type { DesktopInstallState } from '../main_types';
import type { InstallValidation } from '../preload';
import { type ITelemetry, getTelemetry } from '../services/telemetry';
import { useDesktopConfig } from '../store/desktopConfig';
import { canExecute, canExecuteShellCommand, pathAccessible } from '../utils';
import { VirtualEnvironment } from '../virtualEnvironment';

/**
 * Object representing the desktop app installation itself.
 * Used to set app state and validate the environment.
 */
export class ComfyInstallation {
  private _basePath: string;
  public get basePath(): string {
    return this._basePath;
  }

  private _virtualEnvironment: VirtualEnvironment;
  public get virtualEnvironment(): VirtualEnvironment {
    return this._virtualEnvironment;
  }

  /** Installation issues, such as missing base path, no venv.  Populated by {@link validate}. */
  validation: InstallValidation = {
    inProgress: false,
    installState: 'started',
  };

  get hasIssues() {
    return Object.values(this.validation).includes('error');
  }

  /** Returns `true` if {@link state} is 'installed' and there are no issues, otherwise `false`. */
  get isValid() {
    return this.state === 'installed' && !this.hasIssues;
  }

  /** `true` if Manager needs toml and uv to be installed, otherwise `false`. */
  get needsRequirementsUpdate() {
    return this.validation.upgradePackages === 'warning';
  }

  /**
   * Called during/after each step of validation
   * @param data The data to send to the renderer
   */
  onUpdate?: (data: InstallValidation) => void;

  constructor(
    /** Installation state, e.g. `started`, `installed`.  See {@link DesktopSettings}. */
    public state: DesktopInstallState,
    /** The base path of the desktop app.  Models, nodes, and configuration are saved here by default. */
    basePath: string,
    /** The device type to use for the installation. */
    public readonly telemetry: ITelemetry
  ) {
    this._basePath = basePath;
    this._virtualEnvironment = this.createVirtualEnvironment(basePath);
  }

  private createVirtualEnvironment(basePath: string) {
    return new VirtualEnvironment(basePath, {
      telemetry: this.telemetry,
      selectedDevice: useDesktopConfig().get('selectedDevice'),
      pythonMirror: useComfySettings().get('Comfy-Desktop.UV.PythonInstallMirror'),
      pypiMirror: useComfySettings().get('Comfy-Desktop.UV.PypiInstallMirror'),
      torchMirror: useComfySettings().get('Comfy-Desktop.UV.TorchInstallMirror'),
    });
  }

  /**
   * Static factory method. Creates a ComfyInstallation object if previously saved config can be read.
   * @returns A ComfyInstallation (not validated) object if config is saved, otherwise `undefined`.
   * @throws If YAML config is unreadable due to access restrictions
   */
  static async fromConfig(): Promise<ComfyInstallation | undefined> {
    const config = useDesktopConfig();
    const state = config.get('installState');
    const basePath = config.get('basePath');
    if (state && basePath) {
      await ComfySettings.load(basePath);
      await ComfyInstallation.migrateLegacyTorchMirrorIfNeeded();
      return new ComfyInstallation(state, basePath, getTelemetry());
    }
  }

  private static async migrateLegacyTorchMirrorIfNeeded(): Promise<void> {
    const selectedDevice = useDesktopConfig().get('selectedDevice');
    if (selectedDevice !== 'nvidia') return;

    const settings = useComfySettings();
    const torchMirror = settings.get('Comfy-Desktop.UV.TorchInstallMirror');
    if (!torchMirror || torchMirror !== LEGACY_NVIDIA_TORCH_MIRROR) return;

    try {
      settings.set('Comfy-Desktop.UV.TorchInstallMirror', TorchMirrorUrl.Cuda);
      await settings.saveSettings();
      log.info('Migrated legacy NVIDIA torch mirror from cu129 to cu130.');
    } catch (error) {
      log.warn('Failed to migrate legacy NVIDIA torch mirror to cu130.', error);
    }
  }

  /**
   * Validate the installation and add any results to {@link issues}.
   * @returns The validated installation state, along with a list of any issues detected.
   * @throws When the YAML file is present but not readable (access denied, FS error, etc).
   */
  async validate(): Promise<DesktopInstallState> {
    log.info(`Validating installation. Recorded state: [${this.state}]`);
    const validation: InstallValidation = {
      inProgress: true,
      installState: this.state,
    };
    this.validation = validation;
    this.onUpdate?.(validation);

    // Upgraded from a version prior to 0.3.18
    if (!validation.installState && ComfyServerConfig.exists()) {
      log.info('Found extra_models_config.yaml but no recorded state - assuming upgrade from <= 0.3.18');
      validation.installState = 'upgraded';
      this.onUpdate?.(validation);
    }

    // Validate base path
    const basePath = useDesktopConfig().get('basePath');
    if (basePath && (await pathAccessible(basePath))) {
      const restrictionFlags = evaluatePathRestrictions(basePath);
      const isUnsafeBasePath =
        restrictionFlags.isInsideAppInstallDir || restrictionFlags.isInsideUpdaterCache || restrictionFlags.isOneDrive;

      if (isUnsafeBasePath) {
        log.error('"base_path" is in an unsafe location (inside app install directory, updater cache, or OneDrive).', {
          basePath,
          restrictionFlags,
        });

        validation.basePath = 'error';
        validation.unsafeBasePath = true;
        if (restrictionFlags.isInsideAppInstallDir) {
          validation.unsafeBasePathReason = 'appInstallDir';
        } else if (restrictionFlags.isInsideUpdaterCache) {
          validation.unsafeBasePathReason = 'updaterCache';
        } else if (restrictionFlags.isOneDrive) {
          validation.unsafeBasePathReason = 'oneDrive';
        }
      } else {
        await this.updateBasePathAndVenv(basePath);

        validation.basePath = 'OK';
      }

      this.onUpdate?.(validation);
    } else {
      log.error('"base_path" is inaccessible or undefined.');
      validation.basePath = 'error';
    }
    this.onUpdate?.(validation);

    // Validate virtual environment only when the base path is valid and safe
    if (validation.basePath !== 'error') {
      const venv = this.virtualEnvironment;
      if (await venv.exists()) {
        validation.venvDirectory = 'OK';
        this.onUpdate?.(validation);

        // Python interpreter
        validation.pythonInterpreter = (await canExecute(venv.pythonInterpreterPath)) ? 'OK' : 'error';
        if (validation.pythonInterpreter !== 'OK') log.warn('Python interpreter is missing or not executable.');
        this.onUpdate?.(validation);

        // uv
        if (await canExecute(venv.uvPath)) {
          validation.uv = 'OK';
          this.onUpdate?.(validation);

          // Python packages
          try {
            const result = await venv.hasRequirements();
            if (result === 'package-upgrade') {
              validation.pythonPackages = 'OK';
              validation.upgradePackages = 'warning';
            } else {
              validation.pythonPackages = result;
              if (result !== 'OK') log.error('Virtual environment is incomplete.');
            }
          } catch (error) {
            log.error('Failed to read venv packages.', error);
            validation.pythonPackages = 'error';
          }
        } else {
          log.warn('uv is missing or not executable.');
          validation.uv = 'error';
        }
      } else {
        log.warn('Virtual environment is missing.');
        validation.venvDirectory = 'error';
      }
      this.onUpdate?.(validation);
    }

    // Git
    validation.git = (await canExecuteShellCommand('git --help')) ? 'OK' : 'error';
    if (validation.git !== 'OK') log.warn('git not found in path.');
    this.onUpdate?.(validation);

    // Visual C++ Redistributable
    if (process.platform === 'win32') {
      const vcDllPath = `${process.env.SYSTEMROOT}\\System32\\vcruntime140.dll`;
      validation.vcRedist = (await pathAccessible(vcDllPath)) ? 'OK' : 'error';
      if (validation.vcRedist !== 'OK') log.warn(`Visual C++ Redistributable was not found [${vcDllPath}]`);
    } else {
      validation.vcRedist = 'skipped';
    }
    this.onUpdate?.(validation);

    // Complete
    validation.inProgress = false;
    log.info(`Validation result: isValid:${this.isValid}, state:${validation.installState}`, validation);
    this.onUpdate?.(validation);

    return validation.installState;
  }

  /**
   * Migrates the config file to the latest format, after an upgrade of the desktop app executables.
   *
   * Called during app startup, this function ensures that config is in the expected state.
   */
  upgradeConfig() {
    log.verbose(`Upgrading config to latest format.  Current state: [${this.state}]`);
    // Migrate config
    if (this.validation.basePath !== 'error') {
      useDesktopConfig().set('basePath', this.basePath);
    } else {
      log.warn('Skipping save of basePath.');
    }
    this.setState('installed');
  }

  /**
   * Changes the installation state and persists it to disk.
   * @param state The new installation state to set.
   */
  setState(state: DesktopInstallState) {
    this.state = state;
    useDesktopConfig().set('installState', state);
  }

  /**
   * Updates the base path and recreates the virtual environment (object).
   * @param basePath The new base path to set.
   */
  async updateBasePathAndVenv(basePath: string) {
    if (this._basePath === basePath) return;

    this._basePath = basePath;
    this._virtualEnvironment = this.createVirtualEnvironment(basePath);
    useDesktopConfig().set('basePath', basePath);

    // If settings file exists at new location, load it
    await ComfySettings.load(basePath);
  }

  /**
   * Removes the config files. Clean up is not yet impl.
   * @todo Allow normal removal of the app and its effects.
   */
  async uninstall(): Promise<void> {
    if (await pathAccessible(ComfyServerConfig.configPath)) {
      await rm(ComfyServerConfig.configPath);
    }
    await useDesktopConfig().permanentlyDeleteConfigFile();
  }
}
