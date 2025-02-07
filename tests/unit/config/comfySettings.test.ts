import log from 'electron-log/main';
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ComfySettingsData, DEFAULT_SETTINGS } from '@/config/comfySettings';
import type { ComfySettings } from '@/config/comfySettings';

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

vi.mock('@/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue(path.join('test', 'base', 'path')),
  }),
}));

describe('ComfySettings', () => {
  const expectedFilePath = path.join('test', 'base', 'path', 'user', 'default', 'comfy.settings.json');
  let settings: ComfySettings;
  let settingsModule: typeof import('@/config/comfySettings');
  let lockWrites: () => void;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    settingsModule = await import('@/config/comfySettings');
    settings = settingsModule.ComfySettings.getInstance();
    lockWrites = () => settingsModule.ComfySettings.lockWrites();
  });

  describe('write locking', () => {
    it('should allow writes before being locked', async () => {
      await settings.saveSettings();
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(expectedFilePath, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    });

    it('should prevent writes after being locked', async () => {
      lockWrites();
      await expect(settings.saveSettings()).rejects.toThrow('Settings are locked');
      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });

    it('should prevent modifications after being locked', () => {
      lockWrites();
      expect(() => settings.set('Comfy-Desktop.AutoUpdate', false)).toThrow('Settings are locked');
    });

    it('should allow reads after being locked', () => {
      lockWrites();
      expect(() => settings.get('Comfy-Desktop.AutoUpdate')).not.toThrow();
    });

    it('should share lock state across references', () => {
      const settings1 = settings;
      const settings2 = settingsModule.ComfySettings.getInstance();

      lockWrites();

      expect(() => settings1.set('Comfy-Desktop.AutoUpdate', false)).toThrow('Settings are locked');
      expect(() => settings2.set('Comfy-Desktop.AutoUpdate', false)).toThrow('Settings are locked');
    });

    it('should throw error when saving locked settings', async () => {
      lockWrites();
      await expect(settings.saveSettings()).rejects.toThrow('Settings are locked');
    });
  });

  describe('file operations', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Reset internal settings to defaults for each file operation test
      (settings as any).settings = structuredClone(DEFAULT_SETTINGS);
    });

    it('should use correct file path', async () => {
      await settings.saveSettings();
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(expectedFilePath, JSON.stringify(DEFAULT_SETTINGS, null, 2));
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
      expect(settings.get('Comfy-Desktop.AutoUpdate')).toBe(DEFAULT_SETTINGS['Comfy-Desktop.AutoUpdate']);
    });

    it('should save settings to correct path with proper formatting', async () => {
      settings.set('Comfy-Desktop.AutoUpdate', false);
      await settings.saveSettings();

      const writeCall = vi.mocked(fs.writeFile).mock.calls.at(-1);
      if (!writeCall) throw new Error('No write calls recorded');
      const savedJson = JSON.parse(writeCall[1] as string);

      expect(writeCall[0]).toBe(expectedFilePath);
      expect(savedJson['Comfy-Desktop.AutoUpdate']).toBe(false);
    });

    it('should fall back to defaults on file read error', async () => {
      vi.mocked(fs.access).mockResolvedValue();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));

      await settings.loadSettings();
      expect(settings.get('Comfy-Desktop.AutoUpdate')).toBe(DEFAULT_SETTINGS['Comfy-Desktop.AutoUpdate']);
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe('settings operations', () => {
    it('should handle nested objects correctly', () => {
      const customLaunchArgs = { '--port': '8188', '--listen': '0.0.0.0' };
      settings.set('Comfy.Server.LaunchArgs', customLaunchArgs);
      expect(settings.get('Comfy.Server.LaunchArgs')).toEqual(customLaunchArgs);
    });

    it('should preserve primitive and object types when getting/setting values', () => {
      settings.set('Comfy-Desktop.SendStatistics', false);
      expect(typeof settings.get('Comfy-Desktop.SendStatistics')).toBe('boolean');

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
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Invalid JSON'));

      await settings.loadSettings();
      expect(settings.get('Comfy-Desktop.AutoUpdate')).toBe(DEFAULT_SETTINGS['Comfy-Desktop.AutoUpdate']);
    });

    it('should throw error on write error during saveSettings', async () => {
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Permission denied'));
      await expect(settings.saveSettings()).rejects.toThrow('Permission denied');
    });
  });
});
