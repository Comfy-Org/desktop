import { app, dialog, shell } from 'electron';
import log from 'electron-log/main';
import ElectronStore from 'electron-store';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopConfig, useDesktopConfig } from '../../../src/store/desktopConfig';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/user/data'),
    quit: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(),
    showErrorBox: vi.fn(),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}));

vi.mock('electron-log/main', () => ({
  default: {
    verbose: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('electron-store', () => ({
  default: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    rm: vi.fn(),
  },
}));

describe('DesktopConfig', () => {
  let mockStore: {
    get: Mock;
    set: Mock;
    delete: Mock;
  };

  beforeEach(() => {
    mockStore = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    };
    (ElectronStore as unknown as Mock).mockImplementation(() => mockStore);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('load', () => {
    it('should create and return a new instance when successful', async () => {
      const config = await DesktopConfig.load(shell);
      expect(config).toBeInstanceOf(DesktopConfig);
      expect(ElectronStore).toHaveBeenCalled();
    });

    it('should handle invalid JSON by showing reset prompt', async () => {
      const syntaxError = new SyntaxError('Invalid JSON');
      (ElectronStore as unknown as Mock).mockImplementationOnce(() => {
        throw syntaxError;
      });

      (dialog.showMessageBox as Mock).mockResolvedValueOnce({ response: 2 }); // Quit option

      await DesktopConfig.load(shell);

      expect(dialog.showMessageBox).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('invalid'),
        })
      );
      expect(app.quit).toHaveBeenCalled();
    });

    it('should show file in folder when user chooses that option', async () => {
      (ElectronStore as unknown as Mock).mockImplementationOnce(() => {
        throw new SyntaxError('Invalid JSON');
      });

      (dialog.showMessageBox as Mock).mockResolvedValueOnce({ response: 1 }); // Show file option

      await DesktopConfig.load(shell);

      expect(shell.showItemInFolder).toHaveBeenCalledWith(path.join(path.sep, 'mock', 'user', 'data', 'config.json'));
      expect(app.quit).toHaveBeenCalled();
    });

    it('should handle reset confirmation flow', async () => {
      (ElectronStore as unknown as Mock)
        .mockImplementationOnce(() => {
          throw new SyntaxError('Invalid JSON');
        })
        .mockImplementationOnce(() => mockStore);

      (dialog.showMessageBox as Mock)
        .mockResolvedValueOnce({ response: 0 }) // Reset option
        .mockResolvedValueOnce({ response: 1 }); // Confirm reset

      const config = await DesktopConfig.load(shell);

      expect(fs.rm).toHaveBeenCalledWith(path.join(path.sep, 'mock', 'user', 'data', 'config.json'));
      expect(config).toBeInstanceOf(DesktopConfig);
    });

    it('should throw on unknown errors', async () => {
      const unknownError = new Error('Unknown error');
      (ElectronStore as unknown as Mock).mockImplementationOnce(() => {
        throw unknownError;
      });

      await expect(DesktopConfig.load(shell)).rejects.toThrow(
        path.join(path.sep, 'mock', 'user', 'data', 'config.json')
      );
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe('instance methods', () => {
    let config: DesktopConfig;

    beforeEach(async () => {
      config = (await DesktopConfig.load(shell))!;
    });

    describe('get', () => {
      it('should retrieve value with default', () => {
        const defaultValue = 'default';
        config.get('windowStyle', defaultValue as 'default' | 'custom');
        expect(mockStore.get).toHaveBeenCalledWith('windowStyle', defaultValue);
      });

      it('should retrieve value without default', () => {
        config.get('windowStyle');
        expect(mockStore.get).toHaveBeenCalledWith('windowStyle');
      });
    });

    describe('set', () => {
      it('should set value', () => {
        const value = 'default';
        config.set('windowStyle', value);
        expect(mockStore.set).toHaveBeenCalledWith('windowStyle', value);
      });
    });

    describe('delete', () => {
      it('should delete key', () => {
        config.delete('basePath');
        expect(mockStore.delete).toHaveBeenCalledWith('basePath');
      });
    });

    describe('async operations', () => {
      it('should set value asynchronously', async () => {
        const value = 'default';
        await config.setAsync('windowStyle', value);
        expect(mockStore.set).toHaveBeenCalledWith('windowStyle', value);
        expect(log.info).toHaveBeenCalled();
      });

      it('should get value asynchronously', async () => {
        const expectedValue = 'test-value';
        mockStore.get.mockReturnValue(expectedValue);

        const result = await config.getAsync('windowStyle');
        expect(result).toBe(expectedValue);
        expect(mockStore.get).toHaveBeenCalledWith('windowStyle');
      });

      it('should permanently delete config file', async () => {
        await config.permanentlyDeleteConfigFile();
        expect(fs.rm).toHaveBeenCalledWith(path.join(path.sep, 'mock', 'user', 'data', 'config.json'));
      });
    });
  });

  describe('useDesktopConfig', () => {
    it('should return instance after initialization', async () => {
      const config = await DesktopConfig.load(shell);
      expect(useDesktopConfig()).toBe(config);
    });
  });
});
