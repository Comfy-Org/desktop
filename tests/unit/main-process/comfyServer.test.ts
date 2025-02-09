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
      const mainScriptPath = 'main.py';
      const args = {
        port: '8188',
        host: 'localhost',
      };

      const result = ComfyServer.buildLaunchArgs(mainScriptPath, args);

      expect(result).toEqual(['main.py', '--port', '8188', '--host', 'localhost']);
    });

    it('should handle empty string values by only including the flag', () => {
      const mainScriptPath = 'main.py';
      const args = {
        cpu: '',
        port: '8188',
      };

      const result = ComfyServer.buildLaunchArgs(mainScriptPath, args);

      expect(result).toEqual(['main.py', '--cpu', '--port', '8188']);
    });

    it('should handle no arguments', () => {
      const mainScriptPath = 'main.py';
      const args = {};

      const result = ComfyServer.buildLaunchArgs(mainScriptPath, args);

      expect(result).toEqual(['main.py']);
    });

    it('should preserve argument order', () => {
      const mainScriptPath = 'main.py';
      const args = {
        z: '3',
        a: '1',
        b: '2',
      };

      const result = ComfyServer.buildLaunchArgs(mainScriptPath, args);

      // Object entries preserve insertion order in modern JS
      expect(result).toEqual(['main.py', '--z', '3', '--a', '1', '--b', '2']);
    });
  });
});
