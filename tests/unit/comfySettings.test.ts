import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfySettings, type ComfySettingsData, DEFAULT_SETTINGS } from '@/config/comfySettings';

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

async function expectLogError() {
  const log = await import('electron-log/main');
  expect(vi.mocked(log.default.error)).toHaveBeenCalled();
}

describe('ComfySettings', () => {
  let settings: ComfySettings;
  const testBasePath = '/test/path';

  beforeEach(() => {
    settings = new ComfySettings(testBasePath);
    ComfySettings['writeLocked'] = false;
    vi.clearAllMocks();
  });

  describe('write locking', () => {
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

    it('should log error when saving locked settings', async () => {
      ComfySettings.lockWrites();
      await expect(settings.saveSettings()).rejects.toThrow('Settings are locked');
      await expectLogError();
    });
  });

  describe('file operations', () => {
    it('should use correct file path', () => {
      expect(settings.filePath).toBe(path.join(testBasePath, 'user', 'default', 'comfy.settings.json'));
    });

    it('should load settings from file when available', async () => {
      const mockSettings: ComfySettingsData = {
        'Comfy-Desktop.AutoUpdate': false,
        'Comfy-Desktop.SendStatistics': false,
        'Comfy.ColorPalette': 'dark',
        'Comfy.UseNewMenu': 'Top',
        'Comfy.Workflow.WorkflowTabsPosition': 'Topbar',
        'Comfy.Workflow.ShowMissingModelsWarning': true,
        'Comfy.Server.LaunchArgs': { test: 'value' },
        'Comfy-Desktop.UV.PythonInstallMirror': '',
        'Comfy-Desktop.UV.PypiInstallMirror': '',
        'Comfy-Desktop.UV.TorchInstallMirror': '',
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

    it('should save settings to correct path with proper formatting', async () => {
      settings.set('Comfy-Desktop.AutoUpdate', false);
      await settings.saveSettings();

      const writeCall = vi.mocked(fs).writeFile.mock.calls[0];
      const savedJson = JSON.parse(writeCall[1] as string);

      expect(writeCall[0]).toBe(settings.filePath);
      expect(savedJson['Comfy-Desktop.AutoUpdate']).toBe(false);
    });

    it('should fall back to defaults on file read error', async () => {
      vi.mocked(fs.access).mockResolvedValue();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));

      await settings.loadSettings();
      await expectLogError();
      expect(settings.get('Comfy-Desktop.AutoUpdate')).toBe(DEFAULT_SETTINGS['Comfy-Desktop.AutoUpdate']);
    });
  });

  describe('settings operations', () => {
    it('should handle nested objects correctly', () => {
      const customLaunchArgs = { '--port': '8188', '--listen': '0.0.0.0' };
      settings.set('Comfy.Server.LaunchArgs', customLaunchArgs);
      expect(settings.get('Comfy.Server.LaunchArgs')).toEqual(customLaunchArgs);
    });

    it('should preserve primitive and object types when getting/setting values', () => {
      settings.set('Comfy-Desktop.AutoUpdate', false);
      expect(typeof settings.get('Comfy-Desktop.AutoUpdate')).toBe('boolean');

      const serverArgs = { test: 'value' };
      settings.set('Comfy.Server.LaunchArgs', serverArgs);
      expect(typeof settings.get('Comfy.Server.LaunchArgs')).toBe('object');
    });

    it('should fall back to defaults for null/undefined values in settings file', async () => {
      const invalidSettings = {
        'Comfy-Desktop.AutoUpdate': undefined,
        'Comfy.Server.LaunchArgs': null,
      };

      vi.mocked(fs.access).mockResolvedValue();
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(invalidSettings));

      await settings.loadSettings();
      expect(settings.get('Comfy-Desktop.AutoUpdate')).toBe(DEFAULT_SETTINGS['Comfy-Desktop.AutoUpdate']);
      expect(settings.get('Comfy.Server.LaunchArgs')).toEqual(DEFAULT_SETTINGS['Comfy.Server.LaunchArgs']);
    });

    it('should fall back to defaults when settings file contains invalid JSON', async () => {
      vi.mocked(fs.access).mockResolvedValue();
      vi.mocked(fs.readFile).mockResolvedValue('{ invalid json }');

      await settings.loadSettings();
      await expectLogError();
      expect(settings.get('Comfy-Desktop.AutoUpdate')).toBe(DEFAULT_SETTINGS['Comfy-Desktop.AutoUpdate']);
    });

    it('should handle attempts to save null settings', async () => {
      const saveSettingsSpy = vi.spyOn(settings, 'saveSettings');
      // @ts-expect-error: explicitly setting settings to null
      settings['settings'] = null;
      await settings.saveSettings();

      expect(saveSettingsSpy).toHaveReturned();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should log and throw error on write error during saveSettings', async () => {
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Permission denied'));
      await expect(settings.saveSettings()).rejects.toThrow('Permission denied');
      await expectLogError();
    });
  });
});
