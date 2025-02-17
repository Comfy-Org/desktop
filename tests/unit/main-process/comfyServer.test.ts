import { describe, expect, it, vi } from 'vitest';

import { ComfyServer } from '@/main-process/comfyServer';

vi.mock('@/install/resourcePaths', () => ({
  getAppResourcesPath: vi.fn().mockReturnValue('/mocked/app_resources'),
}));

vi.mock('@sentry/electron/main', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  setContext: vi.fn(),
}));

describe('ComfyServer', () => {
  describe('buildLaunchArgs', () => {
    it('should convert basic arguments correctly', () => {
      const args = {
        port: '8188',
        host: 'localhost',
      };

      const result = ComfyServer.buildLaunchArgs(args);

      expect(result).toEqual(['--port', '8188', '--host', 'localhost']);
    });

    it('should handle empty string values by only including the flag', () => {
      const args = {
        cpu: '',
        port: '8188',
      };

      const result = ComfyServer.buildLaunchArgs(args);

      expect(result).toEqual(['--cpu', '--port', '8188']);
    });

    it('should handle no arguments', () => {
      const args = {};

      const result = ComfyServer.buildLaunchArgs(args);

      expect(result).toEqual([]);
    });

    it('should preserve argument order', () => {
      const args = {
        z: '3',
        a: '1',
        b: '2',
      };

      const result = ComfyServer.buildLaunchArgs(args);

      // Object entries preserve insertion order in modern JS
      expect(result).toEqual(['--z', '3', '--a', '1', '--b', '2']);
    });
  });
});
