/**
 * Test suite for UV log parser with actual torch installation logs
 *
 * This test verifies the parser handles the installation completion
 * messages that don't have DEBUG prefixes or timestamps
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { UvLogParser } from '../../src/uvLogParser';

describe('UvLogParser - Torch Installation', () => {
  let parser: UvLogParser;

  beforeEach(() => {
    parser = new UvLogParser();
  });

  describe('Installation Completion Messages', () => {
    it('should parse "Prepared" with seconds (from debug-torch-multi.log)', () => {
      const line = 'Prepared 3 packages in 16.99s';
      const status = parser.parseLine(line);

      expect(status.phase).toBe('prepared');
      expect(status.preparedPackages).toBe(3);
      expect(status.preparationTime).toBe(16_990); // 16.99s = 16990ms
      expect(status.message).toBe('Prepared 3 packages in 16990ms');
    });

    it('should parse "Prepared" with seconds (from debug-torch-single.log)', () => {
      const line = 'Prepared 1 package in 16.18s';
      const status = parser.parseLine(line);

      expect(status.phase).toBe('prepared');
      expect(status.preparedPackages).toBe(1);
      expect(status.preparationTime).toBe(16_180); // 16.18s = 16180ms
    });

    it('should parse "Uninstalled" with milliseconds', () => {
      const line = 'Uninstalled 2 packages in 46ms';
      const status = parser.parseLine(line);

      expect(status.phase).toBe('installing');
      expect(status.message).toBe('Uninstalled 2 packages in 46ms');
    });

    it('should parse "Installed" with milliseconds and mark as complete', () => {
      const line = 'Installed 3 packages in 137ms';
      const status = parser.parseLine(line);

      expect(status.phase).toBe('installed');
      expect(status.installedPackages).toBe(3);
      expect(status.installationTime).toBe(137);
      expect(status.isComplete).toBe(true);
      expect(status.message).toBe('Installed 3 packages in 137ms');
    });

    it('should parse "Installed" singular package', () => {
      const line = 'Installed 1 package in 153ms';
      const status = parser.parseLine(line);

      expect(status.phase).toBe('installed');
      expect(status.installedPackages).toBe(1);
      expect(status.installationTime).toBe(153);
      expect(status.isComplete).toBe(true);
      expect(status.message).toBe('Installed 1 package in 153ms');
    });

    it('should handle edge case of seconds for Installed', () => {
      const line = 'Installed 5 packages in 2.5s';
      const status = parser.parseLine(line);

      expect(status.phase).toBe('installed');
      expect(status.installedPackages).toBe(5);
      expect(status.installationTime).toBe(2500); // 2.5s = 2500ms
      expect(status.isComplete).toBe(true);
    });
  });

  describe('Complete Installation Flow', () => {
    it('should process complete multi-package torch installation', () => {
      const lines = [
        'Prepared 3 packages in 16.99s',
        '  19.046156s DEBUG uv::commands::pip::operations Uninstalled torchaudio (88 files, 36 directories)',
        '  19.075169s DEBUG uv::commands::pip::operations Uninstalled torchvision (266 files, 38 directories)',
        'Uninstalled 2 packages in 46ms',
        ' uv_installer::installer::install_blocking num_wheels=3',
        'Installed 3 packages in 137ms',
      ];

      let finalStatus;
      for (const line of lines) {
        const status = parser.parseLine(line);
        if (status.phase !== 'unknown') {
          finalStatus = status;
        }
      }

      expect(finalStatus).toBeDefined();
      expect(finalStatus?.phase).toBe('installed');
      expect(finalStatus?.isComplete).toBe(true);
    });

    it('should process complete single-package torch installation', () => {
      const lines = [
        'Prepared 1 package in 16.18s',
        ' uv_installer::installer::install_blocking num_wheels=1',
        'Installed 1 package in 153ms',
      ];

      let finalStatus;
      for (const line of lines) {
        const status = parser.parseLine(line);
        if (status.phase !== 'unknown') {
          finalStatus = status;
        }
      }

      expect(finalStatus).toBeDefined();
      expect(finalStatus?.phase).toBe('installed');
      expect(finalStatus?.isComplete).toBe(true);
    });
  });
});
