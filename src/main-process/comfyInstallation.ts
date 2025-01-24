import log from 'electron-log/main';
import { rm } from 'node:fs/promises';

import { ComfyServerConfig } from '../config/comfyServerConfig';
import { ComfySettings } from '../config/comfySettings';
import type { DesktopInstallState } from '../main_types';
import type { InstallValidation, TorchDeviceType } from '../preload';
import { type ITelemetry, getTelemetry } from '../services/telemetry';
import { useDesktopConfig } from '../store/desktopConfig';
import { canExecute, canExecuteShellCommand, pathAccessible } from '../utils';
import { VirtualEnvironment } from '../virtualEnvironment';

/**
 * Object representing the desktop app installation itself.
 * Used to set app state and validate the environment.
 */
export class ComfyInstallation {
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

  virtualEnvironment: VirtualEnvironment;
  comfySettings: ComfySettings;

  _basePath: string;
  /** The base path of the desktop app.  Models, nodes, and configuration are saved here by default. */
  get basePath() {
    return this._basePath;
  }
  set basePath(value: string) {
    // Duplicated in constructor to avoid non-nullable type assertions.
    this._basePath = value;
    this.virtualEnvironment = this.createVirtualEnvironment(value);
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
    public readonly telemetry: ITelemetry,
    public device?: TorchDeviceType
  ) {
    // TypeScript workaround: duplication of basePath setter
    this._basePath = basePath;
    this.comfySettings = new ComfySettings(basePath);
    this.virtualEnvironment = this.createVirtualEnvironment(basePath);
  }

  private createVirtualEnvironment(basePath: string) {
    return new VirtualEnvironment(basePath, {
      telemetry: this.telemetry,
      selectedDevice: this.device,
      pythonMirror: this.comfySettings.get('Comfy-Desktop.PythonInstallMirror'),
      pypiMirror: this.comfySettings.get('Comfy-Desktop.PypiInstallMirror'),
    });
  }

  /**
   * Static factory method. Creates a ComfyInstallation object if previously saved config can be read.
   * @returns A ComfyInstallation (not validated) object if config is saved, otherwise `undefined`.
   * @throws If YAML config is unreadable due to access restrictions
   */
  static fromConfig(): ComfyInstallation | undefined {
    const config = useDesktopConfig();
    const state = config.get('installState');
    const basePath = config.get('basePath');
    const device = config.get('selectedDevice');
    if (state && basePath) return new ComfyInstallation(state, basePath, getTelemetry(), device);
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
    // TODO: Validate more than just the existence of one file
    if (!validation.installState && ComfyServerConfig.exists()) {
      log.info('Found extra_models_config.yaml but no recorded state - assuming upgrade from <= 0.3.18');
      validation.installState = 'upgraded';
      this.onUpdate?.(validation);
    }

    // Validate base path
    const basePath = await this.loadBasePath();
    if (basePath && (await pathAccessible(basePath))) {
      validation.basePath = 'OK';
      this.onUpdate?.(validation);

      const venv = this.createVirtualEnvironment(basePath);
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
            validation.pythonPackages = (await venv.hasRequirements()) ? 'OK' : 'error';
            if (validation.pythonPackages !== 'OK') log.error('Virtual environment is incomplete.');
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
    } else {
      log.error('"base_path" is inaccessible or undefined.');
      validation.basePath = 'error';
    }
    this.onUpdate?.(validation);

    // Git
    validation.git = (await canExecuteShellCommand('git --help')) ? 'OK' : 'error';
    if (validation.git !== 'OK') log.warn('git not found in path.');
    this.onUpdate?.(validation);

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
   * Loads the base path from YAML config. If it is unreadable, warns the user and quits.
   * @returns The base path if read successfully, or `undefined`
   * @throws If the config file is present but not readable
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
        throw new Error(`Unable to read the YAML configuration file.  Please ensure this file is available and can be read:

${ComfyServerConfig.configPath}

If this problem persists, back up and delete the config file, then restart the app.`);
    }
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
   * Removes the config files. Clean up is not yet impl.
   * @todo Allow normal removal of the app and its effects.
   */
  async uninstall(): Promise<void> {
    await rm(ComfyServerConfig.configPath);
    await useDesktopConfig().permanentlyDeleteConfigFile();
  }
}
