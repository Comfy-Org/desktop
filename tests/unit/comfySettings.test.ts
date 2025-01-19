import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfySettings, type ComfySettingsData } from '../../src/config/comfySettings';

vi.mock('electron-log/main', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

describe('ComfySettings', () => {
  let settings: ComfySettings;
  const testBasePath = '/test/path';

  beforeEach(() => {
    settings = new ComfySettings(testBasePath);
    // Reset static state between tests
    ComfySettings['writeLocked'] = false;
    vi.clearAllMocks();
  });

  describe('Write locking', () => {
    it('should allow writes before being locked', async () => {
      await settings.saveSettings();
      expect(vi.mocked(fs).writeFile).toHaveBeenCalled();
    });

    it('should prevent writes after being locked', async () => {
      ComfySettings.lockWrites();
      await expect(settings.saveSettings()).rejects.toThrow('Settings are locked');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should prevent modifications after being locked', () => {
      ComfySettings.lockWrites();
      expect(() => settings.set('Comfy-Desktop.AutoUpdate', false)).toThrow('Settings are locked');
    });

    it('should allow reads after being locked', () => {
      ComfySettings.lockWrites();
      expect(() => settings.get('Comfy-Desktop.AutoUpdate')).not.toThrow();
    });

    it('should share lock state across instances', () => {
      const settings1 = new ComfySettings('/path1');
      const settings2 = new ComfySettings('/path2');

      ComfySettings.lockWrites();

      expect(() => settings1.set('Comfy-Desktop.AutoUpdate', false)).toThrow('Settings are locked');
      expect(() => settings2.set('Comfy-Desktop.AutoUpdate', false)).toThrow('Settings are locked');
    });
  });

  describe('File operations', () => {
    it('should use correct file path', () => {
      expect(settings.filePath).toBe(path.join(testBasePath, 'user', 'default', 'comfy.settings.json'));
    });

    it('should load settings from file when available', async () => {
      const mockSettings: ComfySettingsData = {
        'Comfy-Desktop.AutoUpdate': false,
        'Comfy-Desktop.SendStatistics': false,
        'Comfy.Server.LaunchArgs': { test: 'value' },
      };

      vi.mocked(fs.access).mockResolvedValue();
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockSettings));

      await settings.loadSettings();
      expect(settings.get('Comfy-Desktop.AutoUpdate')).toBe(false);
      expect(settings.get('Comfy.Server.LaunchArgs')).toEqual({ test: 'value' });
      expect(settings.get('Comfy-Desktop.SendStatistics')).toBe(false);
    });

    it('should use default settings when file does not exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      await settings.loadSettings();
      expect(settings.get('Comfy-Desktop.AutoUpdate')).toBe(true);
      expect(settings.get('Comfy-Desktop.SendStatistics')).toBe(true);
    });
  });
});
