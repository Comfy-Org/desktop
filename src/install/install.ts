import { app, ipcMain } from 'electron';
import log from 'electron-log/main';
import { IPC_CHANNELS } from '../constants';
import { createModelConfigFiles, getModelConfigPath } from '../config/extra_model_config';
import fs from 'fs';
import { AppWindow } from '../main-process/appWindow';
import { ComfyConfigManager } from '../config/comfyConfigManager';

type InstallationState =
  | { status: 'NOT_INSTALLED' }
  | { status: 'ASKING_FOR_DIRECTORY'; defaultLocation: string; validationErrorMessage?: string }
  | {
      status: 'INSTALLING';
      location: string;
    }
  | {
      status: 'READY';
      location: string; // Must exist!
    }
  | {
      status: 'ERROR';
      error: Error; // Must exist!
    };

/**
 * This class is responsible for handling the installation of ComfyUI.
 * It registers an IPC handler for the current installation state.
 * It also sends any changes to the state to the renderer process.
 */
export class ComfyUIInstall {
  private static instance: ComfyUIInstall;
  private installLocation: string;
  private defaultInstallLocation: string;
  private state: InstallationState = { status: 'NOT_INSTALLED' };
  private appWindow: AppWindow;

  private constructor(appWindow: AppWindow) {
    const defaultInstallLocation = app.getPath('documents');
    ipcMain.handle(IPC_CHANNELS.DEFAULT_INSTALL_LOCATION, () => defaultInstallLocation); // TODO: Remove after migration.
    ipcMain.handle(IPC_CHANNELS.GET_INSTALLATION_STATE, () => this.state);
    this.installLocation = defaultInstallLocation;
    this.defaultInstallLocation = defaultInstallLocation;
    this.appWindow = appWindow;
  }

  static get(appWindow: AppWindow): ComfyUIInstall {
    if (!ComfyUIInstall.instance) {
      ComfyUIInstall.instance = new ComfyUIInstall(appWindow);
    }
    return ComfyUIInstall.instance;
  }

  setState(state: InstallationState): void {
    log.info('Setting installation state:', state);
    this.state = state;
    this.appWindow.send(IPC_CHANNELS.INSTALLATION_STATE_CHANGED, state);
  }

  public async install(): Promise<void> {
    const firstTimeSetup = await this.isFirstTimeSetup();
    log.info('First time setup:', firstTimeSetup);
    if (!firstTimeSetup) {
      this.appWindow.send(IPC_CHANNELS.FIRST_TIME_SETUP_COMPLETE, null); // TODO:Remove after migration.
      return;
    }
    this.setState({ status: 'ASKING_FOR_DIRECTORY', defaultLocation: this.defaultInstallLocation });
    this.appWindow.send(IPC_CHANNELS.SHOW_SELECT_DIRECTORY, null); // TODO:Remove after migration.
    while (this.state.status === 'ASKING_FOR_DIRECTORY') {
      const selectedDirectory = await this.selectInstallDirectory();
      const { valid, errorMessage } = await this.isValidComfyDirectory(selectedDirectory);
      if (!valid) {
        this.setState({ ...this.state, validationErrorMessage: errorMessage });
        return;
      } else {
        this.setState({ status: 'INSTALLING', location: selectedDirectory });
        this.installLocation = selectedDirectory;
      }
    }

    const actualComfyDirectory = ComfyConfigManager.setUpComfyUI(this.installLocation);
    const modelConfigPath = getModelConfigPath();
    await createModelConfigFiles(modelConfigPath, actualComfyDirectory);

    this.setState({ status: 'READY', location: this.installLocation });
  }

  /**
   * Check if the user has completed the first time setup wizard.
   * This means the extra_models_config.yaml file exists in the user's data directory.
   */
  private async isFirstTimeSetup(): Promise<boolean> {
    const extraModelsConfigPath = getModelConfigPath();
    return !fs.existsSync(extraModelsConfigPath);
  }

  private async selectInstallDirectory(): Promise<string> {
    return new Promise((resolve, reject) => {
      ipcMain.on(IPC_CHANNELS.SELECTED_DIRECTORY, (_event, value: string) => {
        log.info('Directory selected:', value);
        resolve(value);
      });
    });
  }

  public async isValidComfyDirectory(selectedDirectory: string): Promise<{ valid: boolean; errorMessage?: string }> {
    try {
      const files = await fs.promises.readdir(selectedDirectory);

      if (files.includes('ComfyUI')) {
        return {
          valid: false,
          errorMessage: 'A ComfyUI installation already exists in this directory. Please choose another location.',
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errorMessage: 'Unable to access the selected directory. Please ensure you have proper permissions.',
      };
    }
  }
}
