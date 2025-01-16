import { ComfyServerConfig } from '../config/comfyServerConfig';
import { useDesktopConfig } from '../store/desktopConfig';
import type { DesktopSettings } from '../store/desktopSettings';
import { containsDirectory, pathAccessible } from '../utils';
import log from 'electron-log/main';

// TODO: | 'uvMissing' | 'venvMissing' | 'venvInvalid' | 'noPyTorch';
export type ValidationIssue = 'invalidBasePath';

type InstallState = Exclude<DesktopSettings['installState'], undefined>;

/**
 * Object representing the desktop app installation itself.
 * Used to set app state and validate the environment.
 */
export class ComfyInstallation {
  /** Installation issues, such as missing base path, no venv.  Populated by {@link validate}. */
  readonly issues: Set<ValidationIssue> = new Set();

  /** Returns `true` if {@link state} is 'installed' and there are no issues, otherwise `false`. */
  get isValid() {
    return this.state === 'installed' && this.issues.size === 0;
  }

  constructor(
    /** Installation state, e.g. `started`, `installed`.  See {@link DesktopSettings}. */
    public state: InstallState,
    /** The base path of the desktop app.  Models, nodes, and configuration are saved here by default. */
    public basePath: string
  ) {}

  /**
   * Static factory method. Creates a ComfyInstallation object if previously saved config can be read.
   * @returns A ComfyInstallation (not validated) object if config is saved, otherwise `undefined`.
   */
  static fromConfig(): ComfyInstallation | undefined {
    const config = useDesktopConfig();
    const state = config.get('installState');
    const basePath = config.get('basePath');
    if (state && basePath) return new ComfyInstallation(state, basePath);
  }

  /**
   * Validate the installation and add any results to {@link issues}.
   * @returns The validated installation state, along with a list of any issues detected.
   */
  async validate(): Promise<InstallState> {
    log.info(`Validating installation. Recorded state: [${this.state}]`);

    let { state } = this;

    // Upgraded from a version prior to 0.3.18
    // TODO: Validate more than just the existence of one file
    if (!state && ComfyServerConfig.exists()) {
      log.info('Found extra_models_config.yaml but no recorded state - assuming upgrade from <= 0.3.18');
      state = 'upgraded';
    }

    // Validate base path
    const basePath = await this.loadBasePath();
    if (basePath === undefined || !(await pathAccessible(basePath))) {
      log.warn('"base_path" is inaccessible or undefined.');
      this.issues.add('invalidBasePath');
    }

    // TODO: Validate python, venv, etc.

    log.info(`Validation result: isValid:${this.isValid}, state:${state}, issues:${this.issues.size}`);
    return state;
  }

  /**
   * Loads the base path from YAML config. If it is unreadable, warns the user and quits.
   * @returns The base path if read successfully, or `undefined`
   * @throws If the config file is unreadable
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
    // Migrate config
    if (!this.issues.has('invalidBasePath')) {
      useDesktopConfig().set('basePath', this.basePath);
    }
    this.setState('installed');
  }

  /**
   * Set a new base path in the YAML config file.
   * @param newBasePath The new base path to use.
   * @returns `true` if the new base path is valid and can be written to the config file, otherwise `false`
   */
  async updateBasePath(newBasePath: string): Promise<boolean> {
    if (!newBasePath) return false;

    // TODO: Allow creation of new venv
    if (!(await containsDirectory(newBasePath, '.venv'))) return false;

    this.basePath = newBasePath;
    // TODO: SoC violation
    return await ComfyServerConfig.setBasePathInDefaultConfig(newBasePath);
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
