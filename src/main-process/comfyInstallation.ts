import { ComfyServerConfig } from '../config/comfyServerConfig';
import { useDesktopConfig } from '../store/desktopConfig';
import { canExecute, pathAccessible, canExecuteShellCommand } from '../utils';
import type { DesktopSettings } from '../store/desktopSettings';
import log from 'electron-log/main';
import type { TorchDeviceType, InstallValidation } from '../preload';
import { VirtualEnvironment } from '../virtualEnvironment';

type InstallState = Exclude<DesktopSettings['installState'], undefined>;

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

  #basePath: string;
  /** The base path of the desktop app.  Models, nodes, and configuration are saved here by default. */
  get basePath() {
    return this.#basePath;
  }
  set basePath(value: string) {
    // Duplicated in constructor to avoid non-nullable type assertions.
    this.#basePath = value;
    this.virtualEnvironment = new VirtualEnvironment(value, this.device);
  }

  /**
   * Called during/after each step of validation
   * @param data The data to send to the renderer
   */
  onUpdate?: (data: InstallValidation) => void;

  constructor(
    /** Installation state, e.g. `started`, `installed`.  See {@link DesktopSettings}. */
    public state: InstallState,
    /** The base path of the desktop app.  Models, nodes, and configuration are saved here by default. */
    basePath: string,
    public device: TorchDeviceType | undefined
  ) {
    // TypeScript workaround: duplication of basePath setter
    this.#basePath = basePath;
    this.virtualEnvironment = new VirtualEnvironment(basePath, this.device);
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
    if (state && basePath) return new ComfyInstallation(state, basePath, device);
  }

  /**
   * Validate the installation and add any results to {@link ComfyInstallation.validation}.
   * @returns The validated installation state
   * @throws When the YAML file is present but not readable (access denied, FS error, etc).
   */
  async validate(): Promise<InstallState> {
    log.info(`Validating installation. Recorded state: [${this.state}]`);
    const validation: InstallValidation = {
      inProgress: true,
      installState: this.state,
    };
    this.validation = validation;
    const update = () => this.onUpdate?.(validation);
    update();

    // Upgraded from a version prior to 0.3.18
    // TODO: Validate more than just the existence of one file
    if (!validation.installState && ComfyServerConfig.exists()) {
      log.info('Found extra_models_config.yaml but no recorded state - assuming upgrade from <= 0.3.18');
      validation.installState = 'upgraded';
      update();
    }

    // Validate base path
    const basePath = await this.loadBasePath();
    if (basePath && (await pathAccessible(basePath))) {
      validation.basePath = 'OK';
      update();

      // TODO: Validate content of venv, etc.
      const venv = new VirtualEnvironment(basePath, this.device);
      if (await venv.exists()) {
        validation.venvDirectory = 'OK';
        update();

        // Python interpreter
        validation.pythonInterpreter = (await canExecute(venv.pythonInterpreterPath)) ? 'OK' : 'error';
        if (validation.pythonInterpreter !== 'OK') log.warn('Python interpreter is missing or not executable.');
        update();

        // uv
        if (await canExecute(venv.uvPath)) {
          validation.uv = 'OK';
          update();

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
    update();

    // Git
    // TODO: Accurate cross-platform PATH search `git` executable
    validation.git = (await canExecuteShellCommand('git --help')) ? 'OK' : 'error';
    if (validation.git !== 'OK') log.warn('git not found in path.');
    update();

    if (process.platform === 'win32') {
      const vcDllPath = `${process.env.SYSTEMROOT}\\System32\\vcruntime140.dll`;
      validation.vcRedist = (await pathAccessible(vcDllPath)) ? 'OK' : 'error';
      if (validation.vcRedist !== 'OK') log.warn(`Visual C++ Redistributable was not found [${vcDllPath}]`);
    } else {
      validation.vcRedist = 'skipped';
    }
    update();

    // Complete
    validation.inProgress = false;
    log.info(`Validation result: isValid:${this.isValid}, state:${validation.installState}`, validation);
    update();

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
    if (this.validation.basePath === 'OK') {
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
  setState(state: InstallState) {
    this.state = state;
    useDesktopConfig().set('installState', state);
  }
}
