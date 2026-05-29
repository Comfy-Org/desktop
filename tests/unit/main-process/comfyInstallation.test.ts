import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineScopeConfig } from '@/config/machineConfig';
import { ComfyInstallation } from '@/main-process/comfyInstallation';
import type { ITelemetry } from '@/services/telemetry';

const {
  mockPathAccessible,
  mockRm,
  mockReadMachineConfig,
  mockGetMachineConfigPath,
  mockDesktopConfig,
  mockComfySettings,
  mockComfySettingsLoad,
  mockComfyServerConfigExists,
  mockSetBasePathInDefaultConfig,
  mockGetTelemetry,
} = vi.hoisted(() => ({
  mockPathAccessible: vi.fn(),
  mockRm: vi.fn(),
  mockReadMachineConfig: vi.fn(),
  mockGetMachineConfigPath: vi.fn(),
  mockDesktopConfig: {
    get: vi.fn(),
    set: vi.fn(),
    permanentlyDeleteConfigFile: vi.fn(() => Promise.resolve()),
  },
  mockComfySettings: {
    get: vi.fn(),
  },
  mockComfySettingsLoad: vi.fn(),
  mockComfyServerConfigExists: vi.fn(),
  mockSetBasePathInDefaultConfig: vi.fn(),
  mockGetTelemetry: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  rm: mockRm,
}));

vi.mock('@/utils', () => ({
  pathAccessible: mockPathAccessible,
  canExecute: vi.fn(),
  canExecuteShellCommand: vi.fn(),
}));

vi.mock('@/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn(() => mockDesktopConfig),
}));

vi.mock('@/config/comfySettings', () => ({
  ComfySettings: {
    load: mockComfySettingsLoad,
  },
  useComfySettings: vi.fn(() => mockComfySettings),
}));

vi.mock('@/virtualEnvironment', () => ({
  VirtualEnvironment: vi.fn(() => ({
    exists: vi.fn(),
    hasRequirements: vi.fn(),
    pythonInterpreterPath: '',
    uvPath: '',
  })),
}));

vi.mock('@/config/comfyServerConfig', () => ({
  ComfyServerConfig: {
    configPath: '/user/extra_models_config.yaml',
    exists: mockComfyServerConfigExists,
    setBasePathInDefaultConfig: mockSetBasePathInDefaultConfig,
  },
}));

vi.mock('@/config/machineConfig', () => ({
  getMachineConfigPath: mockGetMachineConfigPath,
  readMachineConfig: mockReadMachineConfig,
  shouldUseMachineScope: vi.fn(),
  writeMachineConfig: vi.fn(),
}));

vi.mock('@/services/telemetry', () => ({
  getTelemetry: mockGetTelemetry,
}));

const createMockTelemetry = (): ITelemetry => ({
  track: vi.fn(),
  hasConsent: true,
  flush: vi.fn(),
  registerHandlers: vi.fn(),
  loadGenerationCount: vi.fn(),
});

const createMachineConfig = (basePath: string): MachineScopeConfig => ({
  version: 1,
  installState: 'installed',
  basePath,
  updatedAt: '2026-02-07T00:00:00.000Z',
});

describe('ComfyInstallation fromConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComfySettingsLoad.mockResolvedValue(mockComfySettings);
    mockComfyServerConfigExists.mockReturnValue(false);
    mockSetBasePathInDefaultConfig.mockResolvedValue(true);
    mockGetTelemetry.mockReturnValue(createMockTelemetry());
    mockReadMachineConfig.mockReturnValue(undefined);
  });

  it('hydrates missing per-user config from machine scope config', async () => {
    mockDesktopConfig.get.mockImplementation((key: string) => {
      if (key === 'installState' || key === 'basePath') return undefined;
      return undefined;
    });
    mockReadMachineConfig.mockReturnValue(createMachineConfig('/machine/base'));

    const installation = await ComfyInstallation.fromConfig();

    expect(installation).toBeDefined();
    expect(installation?.state).toBe('installed');
    expect(installation?.basePath).toBe('/machine/base');
    expect(mockDesktopConfig.set).toHaveBeenCalledWith('installState', 'installed');
    expect(mockDesktopConfig.set).toHaveBeenCalledWith('basePath', '/machine/base');
    expect(mockSetBasePathInDefaultConfig).toHaveBeenCalledWith('/machine/base');
    expect(mockComfySettingsLoad).toHaveBeenCalledWith('/machine/base');
  });
});

describe('ComfyInstallation uninstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComfySettingsLoad.mockResolvedValue(mockComfySettings);
    mockGetTelemetry.mockReturnValue(createMockTelemetry());
    mockPathAccessible.mockResolvedValue(false);
    mockGetMachineConfigPath.mockReturnValue('/machine/machine-config.json');
    mockReadMachineConfig.mockReturnValue(undefined);
    mockDesktopConfig.permanentlyDeleteConfigFile.mockResolvedValue(undefined);
  });

  it('does not delete machine config during per-user uninstall', async () => {
    mockReadMachineConfig.mockReturnValue(createMachineConfig('/machine/base'));
    mockPathAccessible.mockImplementation((targetPath: string) => targetPath === '/user/extra_models_config.yaml');

    const installation = new ComfyInstallation('installed', '/users/alice/comfy', createMockTelemetry());
    await installation.uninstall();

    expect(mockRm).toHaveBeenCalledTimes(1);
    expect(mockRm).toHaveBeenCalledWith('/user/extra_models_config.yaml');
    expect(mockRm).not.toHaveBeenCalledWith('/machine/machine-config.json');
    expect(mockDesktopConfig.permanentlyDeleteConfigFile).toHaveBeenCalledTimes(1);
  });

  it('deletes machine config when uninstalling the machine-scoped install', async () => {
    mockReadMachineConfig.mockReturnValue(createMachineConfig('/machine/base'));
    mockPathAccessible.mockImplementation(
      (targetPath: string) =>
        targetPath === '/user/extra_models_config.yaml' || targetPath === '/machine/machine-config.json'
    );

    const installation = new ComfyInstallation('installed', '/machine/base', createMockTelemetry());
    await installation.uninstall();

    expect(mockRm).toHaveBeenCalledTimes(2);
    expect(mockRm).toHaveBeenCalledWith('/user/extra_models_config.yaml');
    expect(mockRm).toHaveBeenCalledWith('/machine/machine-config.json');
    expect(mockDesktopConfig.permanentlyDeleteConfigFile).toHaveBeenCalledTimes(1);
  });
});
