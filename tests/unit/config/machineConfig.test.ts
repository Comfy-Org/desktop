import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getDefaultWindowsMachineBasePath,
  getMachineConfigPath,
  getMachineRootPath,
  getWindowsProgramDataPath,
  isPathUnderWindowsProgramData,
  readMachineConfig,
  resolveModelConfigPath,
  resolvePreferredWindowsInstallPath,
  shouldUseMachineScope,
  writeMachineConfig,
} from '@/config/machineConfig';

const originalProcess = process;
const originalEnv = process.env;

const withWindowsProcess = (envOverrides: NodeJS.ProcessEnv = {}) => {
  vi.stubGlobal('process', {
    ...originalProcess,
    platform: 'win32',
    env: {
      ...originalEnv,
      ...envOverrides,
    },
  });
};

describe('machineConfig', () => {
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('resolves ProgramData-rooted machine paths on Windows', () => {
    withWindowsProcess({ ProgramData: String.raw`D:\ProgramData` });

    expect(getWindowsProgramDataPath()).toBe(String.raw`D:\ProgramData`);
    expect(getMachineRootPath()).toBe(path.win32.join(String.raw`D:\ProgramData`, 'ComfyUI'));
    expect(getMachineConfigPath()).toBe(path.win32.join(String.raw`D:\ProgramData`, 'ComfyUI', 'machine-config.json'));
    expect(getDefaultWindowsMachineBasePath()).toBe(path.win32.join(String.raw`D:\ProgramData`, 'ComfyUI', 'base'));
  });

  it('detects whether a path is under ProgramData', () => {
    withWindowsProcess({ ProgramData: String.raw`C:\ProgramData` });

    expect(isPathUnderWindowsProgramData(String.raw`C:\ProgramData\ComfyUI\base`)).toBe(true);
    expect(isPathUnderWindowsProgramData(String.raw`C:\Users\Test\ComfyUI`)).toBe(false);
  });

  it('reads machine config when valid', () => {
    withWindowsProcess({ ProgramData: String.raw`C:\ProgramData` });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        version: 1,
        installState: 'installed',
        basePath: String.raw`C:\ProgramData\ComfyUI\base`,
        modelConfigPath: String.raw`C:\ProgramData\ComfyUI\extra_models_config.yaml`,
        autoUpdate: false,
        preseedConfigDir: String.raw`D:\OEM\ComfySeed`,
        updatedAt: '2026-02-07T00:00:00.000Z',
      })
    );

    const config = readMachineConfig();
    expect(config).toMatchObject({
      installState: 'installed',
      autoUpdate: false,
      preseedConfigDir: String.raw`D:\OEM\ComfySeed`,
    });
  });

  it('writes machine config for Windows scope', () => {
    withWindowsProcess({ ProgramData: String.raw`C:\ProgramData` });
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    const result = writeMachineConfig({
      installState: 'started',
      basePath: String.raw`C:\ProgramData\ComfyUI\base`,
      modelConfigPath: String.raw`C:\ProgramData\ComfyUI\extra_models_config.yaml`,
      autoUpdate: true,
    });

    expect(result).toBe(true);
    expect(mkdirSpy).toHaveBeenCalledWith(path.win32.join(String.raw`C:\ProgramData`, 'ComfyUI'), { recursive: true });
    expect(writeSpy).toHaveBeenCalled();
  });

  it('resolves model config path from machine config when present', () => {
    withWindowsProcess({ ProgramData: String.raw`C:\ProgramData` });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        version: 1,
        installState: 'installed',
        basePath: String.raw`C:\ProgramData\ComfyUI\base`,
        modelConfigPath: String.raw`C:\ProgramData\ComfyUI\extra_models_config.yaml`,
        autoUpdate: false,
        updatedAt: '2026-02-07T00:00:00.000Z',
      })
    );

    const resolved = resolveModelConfigPath(String.raw`C:\Users\user\AppData\Roaming\ComfyUI\extra_models_config.yaml`);
    expect(resolved).toBe(String.raw`C:\ProgramData\ComfyUI\extra_models_config.yaml`);
  });

  it('enables machine scope when base path is under ProgramData', () => {
    withWindowsProcess({ ProgramData: String.raw`C:\ProgramData` });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(shouldUseMachineScope(String.raw`C:\ProgramData\ComfyUI\base`)).toBe(true);
    expect(shouldUseMachineScope(String.raw`C:\Users\Test\ComfyUI`)).toBe(false);
  });

  it('prefers ProgramData base path for machine installs without existing machine config', () => {
    withWindowsProcess({
      ProgramData: String.raw`C:\ProgramData`,
      ProgramFiles: String.raw`C:\Program Files`,
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const resolved = resolvePreferredWindowsInstallPath(String.raw`C:\Program Files\ComfyUI\ComfyUI.exe`);
    expect(resolved).toBe(path.win32.join(String.raw`C:\ProgramData`, 'ComfyUI', 'base'));
  });
});
