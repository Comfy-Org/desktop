import os from 'node:os';

export function getDefaultShell(): string {
  switch (os.platform()) {
    case 'win32':
      return 'powershell.exe';
    case 'darwin':
      return 'zsh';
    default: // Linux and others
      return 'bash';
  }
}
