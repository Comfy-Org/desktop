import { app } from 'electron';
import { ComfyServerConfig } from '../config/comfyServerConfig';
import path from 'path';

export async function getBasePath(): Promise<string | null> {
  const modelConfigPath = ComfyServerConfig.configPath;
  return ComfyServerConfig.readBasePathFromConfig(modelConfigPath);
}

export async function getPythonInstallPath(): Promise<string | null> {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'assets');
  }

  return getBasePath();
}

export async function getAppResourcesPath(): Promise<string> {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'assets');
  }

  return process.resourcesPath;
}
