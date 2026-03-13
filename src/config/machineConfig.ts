import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';

import type { DesktopInstallState } from '../store/desktopSettings';

export const MACHINE_CONFIG_VERSION = 1;
export const MACHINE_ROOT_DIR_NAME = 'ComfyUI';
export const MACHINE_CONFIG_FILE_NAME = 'machine-config.json';
export const MACHINE_MODEL_CONFIG_FILE_NAME = 'extra_models_config.yaml';
const WINDOWS_DEFAULT_SYSTEM_DRIVE = 'C:';

export interface MachineScopeConfig {
  version: number;
  installState: DesktopInstallState;
  basePath: string;
  modelConfigPath: string;
  autoUpdate: boolean;
  preseedConfigDir?: string;
  updatedAt: string;
}

type WritableMachineScopeConfig = Omit<MachineScopeConfig, 'version' | 'updatedAt'>;

const isDesktopInstallState = (value: unknown): value is DesktopInstallState => {
  return value === 'started' || value === 'installed' || value === 'upgraded';
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

const normalizePathForComparison = (targetPath: string): string => {
  return path.win32.resolve(targetPath).toLowerCase();
};

const isPathInside = (candidate: string, parent: string): boolean => {
  if (candidate === parent) return true;

  const relative = path.win32.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.win32.isAbsolute(relative));
};

const isMachineScopeConfig = (value: unknown): value is MachineScopeConfig => {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<MachineScopeConfig>;
  return (
    candidate.version === MACHINE_CONFIG_VERSION &&
    isDesktopInstallState(candidate.installState) &&
    isNonEmptyString(candidate.basePath) &&
    isNonEmptyString(candidate.modelConfigPath) &&
    typeof candidate.autoUpdate === 'boolean' &&
    (candidate.preseedConfigDir === undefined || isNonEmptyString(candidate.preseedConfigDir)) &&
    isNonEmptyString(candidate.updatedAt)
  );
};

export const isWindows = (): boolean => process.platform === 'win32';

export const getWindowsProgramDataPath = (): string | undefined => {
  if (!isWindows()) return undefined;

  const programData = process.env.ProgramData?.trim();
  if (programData) return programData;

  const systemDrive = process.env.SystemDrive?.trim();
  const drive = systemDrive && /^[a-z]:$/i.test(systemDrive) ? systemDrive : WINDOWS_DEFAULT_SYSTEM_DRIVE;
  return path.win32.join(drive, 'ProgramData');
};

export const getMachineRootPath = (): string | undefined => {
  const programData = getWindowsProgramDataPath();
  if (!programData) return undefined;
  return path.win32.join(programData, MACHINE_ROOT_DIR_NAME);
};

export const getMachineConfigPath = (): string | undefined => {
  const rootPath = getMachineRootPath();
  if (!rootPath) return undefined;
  return path.win32.join(rootPath, MACHINE_CONFIG_FILE_NAME);
};

export const getMachineModelConfigPath = (): string | undefined => {
  const rootPath = getMachineRootPath();
  if (!rootPath) return undefined;
  return path.win32.join(rootPath, MACHINE_MODEL_CONFIG_FILE_NAME);
};

export const getDefaultWindowsMachineBasePath = (): string | undefined => {
  const rootPath = getMachineRootPath();
  if (!rootPath) return undefined;
  return path.win32.join(rootPath, 'base');
};

export const isPathUnderWindowsProgramData = (targetPath: string): boolean => {
  const programDataPath = getWindowsProgramDataPath();
  if (!isWindows() || !programDataPath || !targetPath) return false;

  const normalizedTargetPath = normalizePathForComparison(targetPath);
  const normalizedProgramDataPath = normalizePathForComparison(programDataPath);
  return isPathInside(normalizedTargetPath, normalizedProgramDataPath);
};

export const isWindowsMachineInstallExePath = (exePath: string): boolean => {
  if (!isWindows() || !exePath) return false;

  const normalizedExePath = normalizePathForComparison(exePath);
  const roots = [
    process.env.ProgramFiles?.trim(),
    process.env['ProgramFiles(x86)']?.trim(),
    path.win32.join(WINDOWS_DEFAULT_SYSTEM_DRIVE, 'Program Files'),
    path.win32.join(WINDOWS_DEFAULT_SYSTEM_DRIVE, 'Program Files (x86)'),
  ].filter((candidate): candidate is string => !!candidate);

  return roots.some((root) => isPathInside(normalizedExePath, normalizePathForComparison(root)));
};

export const readMachineConfig = (): MachineScopeConfig | undefined => {
  const configPath = getMachineConfigPath();
  if (!isWindows() || !configPath || !fs.existsSync(configPath)) return undefined;

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content) as unknown;

    if (!isMachineScopeConfig(parsed)) {
      log.warn('Machine scope config is invalid and will be ignored.', { configPath });
      return undefined;
    }

    return parsed;
  } catch (error) {
    log.warn('Failed reading machine scope config. Falling back to user config.', { configPath, error });
    return undefined;
  }
};

export const writeMachineConfig = (config: WritableMachineScopeConfig): boolean => {
  const configPath = getMachineConfigPath();
  const rootPath = getMachineRootPath();
  if (!isWindows() || !configPath || !rootPath) return false;

  try {
    fs.mkdirSync(rootPath, { recursive: true });
    const payload: MachineScopeConfig = {
      ...config,
      version: MACHINE_CONFIG_VERSION,
      updatedAt: new Date().toISOString(),
    };
    if (!payload.preseedConfigDir?.trim()) {
      delete payload.preseedConfigDir;
    }
    fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch (error) {
    log.error('Failed writing machine scope config.', { configPath, error });
    return false;
  }
};

export const shouldUseMachineScope = (basePath: string): boolean => {
  if (!isWindows()) return false;
  if (isPathUnderWindowsProgramData(basePath)) return true;
  return !!readMachineConfig();
};

export const resolveModelConfigPath = (userScopedConfigPath: string): string => {
  return readMachineConfig()?.modelConfigPath ?? userScopedConfigPath;
};

export const resolvePreferredWindowsInstallPath = (exePath: string): string | undefined => {
  if (!isWindows()) return undefined;
  const machineConfig = readMachineConfig();
  if (machineConfig?.basePath) return machineConfig.basePath;
  if (!isWindowsMachineInstallExePath(exePath)) return undefined;
  return getDefaultWindowsMachineBasePath();
};
