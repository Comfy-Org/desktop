import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyInstallation } from '@/main-process/comfyInstallation';
import type { ITelemetry } from '@/services/telemetry';

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
  },
}));

vi.mock('@/virtualEnvironment', () => ({
  VirtualEnvironment: vi.fn(() => ({})),
}));

const createDirectories = vi.fn();
const isComfyDirectory = vi.fn();

vi.mock('@/config/comfyConfigManager', () => ({
  ComfyConfigManager: {
    createComfyDirectories: createDirectories,
    isComfyUIDirectory: isComfyDirectory,
  },
}));

vi.mock('@/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn(() => ({
    get: vi.fn((key: string) => {
      if (key === 'selectedDevice') return 'cpu';
      if (key === 'basePath') return '/base/path';
      return undefined;
    }),
    set: vi.fn(),
  })),
}));

vi.mock('@/config/comfySettings', () => ({
  useComfySettings: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
  ComfySettings: {
    load: vi.fn(),
  },
}));

const telemetry: ITelemetry = {
  track: vi.fn(),
  hasConsent: true,
  flush: vi.fn(),
  registerHandlers: vi.fn(),
  loadGenerationCount: vi.fn(),
};

describe('ComfyInstallation.ensureBaseDirectoryStructure', () => {
  const basePath = '/base/path';
  let installation: ComfyInstallation;

  beforeEach(() => {
    vi.clearAllMocks();
    installation = new ComfyInstallation('installed', basePath, telemetry);
  });

  it('creates and validates directory structure', () => {
    isComfyDirectory.mockReturnValue(true);

    const result = (installation as any).ensureBaseDirectoryStructure(basePath);

    expect(result).toBe(true);
    expect(createDirectories).toHaveBeenCalledWith(basePath);
    expect(isComfyDirectory).toHaveBeenCalledWith(basePath);
  });

  it('returns false when directory creation throws', () => {
    createDirectories.mockImplementation(() => {
      throw new Error('fail');
    });

    const result = (installation as any).ensureBaseDirectoryStructure(basePath);

    expect(result).toBe(false);
    expect(isComfyDirectory).not.toHaveBeenCalled();
  });

  it('returns false when directory validation fails', () => {
    isComfyDirectory.mockReturnValue(false);

    const result = (installation as any).ensureBaseDirectoryStructure(basePath);

    expect(result).toBe(false);
    expect(createDirectories).toHaveBeenCalledWith(basePath);
    expect(isComfyDirectory).toHaveBeenCalledWith(basePath);
  });
});
