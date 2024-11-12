import { app, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../constants';
import log from 'electron-log/main';
import { getModelConfigPath } from '../config/extra_model_config';
import { getBasePath } from '../install/resourcePaths';

export class PathHandlers {
  constructor() {}

  registerHandlers() {
    ipcMain.on(IPC_CHANNELS.OPEN_LOGS_PATH, (): void => {
      shell.openPath(app.getPath('logs'));
    });

    ipcMain.handle(IPC_CHANNELS.GET_MODEL_CONFIG_PATH, (): string => {
      return getModelConfigPath();
    });

    ipcMain.handle(IPC_CHANNELS.GET_BASE_PATH, async (): Promise<string | null> => {
      return getBasePath();
    });

    ipcMain.on(IPC_CHANNELS.OPEN_PATH, (event, folderPath: string): void => {
      log.info(`Opening path: ${folderPath}`);
      shell.openPath(folderPath);
    });
  }
}
