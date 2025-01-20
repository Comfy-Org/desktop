import { ipcMain } from 'electron';
import fs from 'node:fs';
import si from 'systeminformation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../src/constants';
import { PathHandlers } from '../../src/handlers/pathHandlers';

const REQUIRED_SPACE = 10 * 1024 * 1024 * 1024; // 10GB
const DEFAULT_FREE_SPACE = 20 * 1024 * 1024 * 1024; // 20GB
const LOW_FREE_SPACE = 5 * 1024 * 1024 * 1024; // 5GB

vi.mock('systeminformation');
vi.mock('node:fs');
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}));

const mockDiskSpace = (available: number) => {
  vi.mocked(si.fsSize).mockResolvedValue([
    {
      fs: 'test',
      type: 'test',
      size: 100,
      used: 0,
      available,
      mount: '/',
      use: 0,
      rw: true,
    },
  ]);
};

const mockFileSystem = ({ exists = true, writable = true } = {}) => {
  vi.mocked(fs.existsSync).mockReturnValue(exists);
  if (writable) {
    vi.mocked(fs.accessSync).mockReturnValue();
  } else {
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });
  }
};

describe('Install Path Validation', () => {
  let validateHandler: (event: unknown, path: string) => Promise<unknown>;

  beforeEach(() => {
    vi.resetAllMocks();
    new PathHandlers().registerHandlers();

    // Get the validation handler that was registered
    validateHandler = vi
      .mocked(ipcMain.handle)
      .mock.calls.find((call) => call[0] === IPC_CHANNELS.VALIDATE_INSTALL_PATH)?.[1] as typeof validateHandler;

    // Default disk space mock
    mockDiskSpace(DEFAULT_FREE_SPACE);
  });

  it('accepts valid install path with sufficient space', async () => {
    mockFileSystem({ exists: true, writable: true });

    const result = await validateHandler({}, '/valid/path');
    expect(result).toEqual({
      isValid: true,
      exists: true,
      freeSpace: DEFAULT_FREE_SPACE,
      requiredSpace: REQUIRED_SPACE,
    });
  });

  it('rejects path with insufficient disk space', async () => {
    mockFileSystem({ exists: true, writable: true });
    mockDiskSpace(LOW_FREE_SPACE);

    const result = await validateHandler({}, '/low/space/path');
    expect(result).toEqual({
      isValid: false,
      exists: true,
      freeSpace: LOW_FREE_SPACE,
      requiredSpace: REQUIRED_SPACE,
    });
  });

  it('rejects path with missing parent directory', async () => {
    mockFileSystem({ exists: false });

    const result = await validateHandler({}, '/missing/parent/path');
    expect(result).toEqual({
      isValid: false,
      parentMissing: true,
      freeSpace: DEFAULT_FREE_SPACE,
      requiredSpace: REQUIRED_SPACE,
    });
  });

  it('rejects non-writable path', async () => {
    mockFileSystem({ exists: true, writable: false });

    const result = await validateHandler({}, '/non/writable/path');
    expect(result).toEqual({
      isValid: false,
      cannotWrite: true,
      exists: true,
      freeSpace: DEFAULT_FREE_SPACE,
      requiredSpace: REQUIRED_SPACE,
    });
  });
});
