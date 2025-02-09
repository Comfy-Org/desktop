import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { getDefaultShell, getDefaultShellArgs } from '../../../src/shell/util';

vi.mock('node:os');

describe('shell utilities', () => {
  describe('getDefaultShell', () => {
    it('should return powershell path on Windows', () => {
      vi.spyOn(os, 'platform').mockReturnValue('win32');
      process.env.SYSTEMROOT = String.raw`C:\Windows`;
      expect(getDefaultShell()).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`);
    });

    it('should return zsh on macOS', () => {
      vi.spyOn(os, 'platform').mockReturnValue('darwin');
      expect(getDefaultShell()).toBe('zsh');
    });

    it('should return bash on Linux', () => {
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      expect(getDefaultShell()).toBe('bash');
    });
  });

  describe('getDefaultShellArgs', () => {
    it('should return ["-df"] on macOS', () => {
      vi.spyOn(os, 'platform').mockReturnValue('darwin');
      expect(getDefaultShellArgs()).toEqual(['-df']);
    });

    it('should return empty array on Windows', () => {
      vi.spyOn(os, 'platform').mockReturnValue('win32');
      expect(getDefaultShellArgs()).toEqual([]);
    });

    it('should return empty array on Linux', () => {
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      expect(getDefaultShellArgs()).toEqual(['--noprofile --norc']);
    });
  });
});
