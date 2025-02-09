import os from 'node:os';

export function getDefaultShell(): string {
  switch (os.platform()) {
    case 'win32':
      // Use full path to avoid e.g. https://github.com/Comfy-Org/desktop/issues/584
      return `${process.env.SYSTEMROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    case 'darwin':
      return 'zsh';
    default: // Linux and others
      return 'bash';
  }
}

export function getDefaultShellArgs(): string[] {
  switch (os.platform()) {
    case 'darwin':
      return ['-df']; // Prevent loading initialization files for zsh
    case 'win32':
      return [];
    default: // Linux and others
      return ['--noprofile --norc'];
  }
}
