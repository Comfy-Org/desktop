import envPaths from 'env-paths';
import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// Dumping ground for basic utilities that can be shared by e2e and unit tests

export enum FilePermission {
  Exists = constants.F_OK,
  Readable = constants.R_OK,
  Writable = constants.W_OK,
  Executable = constants.X_OK,
}

export async function pathExists(path: string, permission: FilePermission = FilePermission.Exists) {
  try {
    await access(path, permission);
    return true;
  } catch {
    return false;
  }
}

export function getComfyUIAppDataPath() {
  switch (process.platform) {
    case 'win32':
      if (!process.env.APPDATA) throw new Error('APPDATA environment variable is not set.');
      return path.join(process.env.APPDATA, 'ComfyUI');
    case 'darwin':
      return envPaths('ComfyUI').data;
    default:
      return envPaths('ComfyUI').config;
  }
}

export function getDefaultInstallLocation() {
  switch (process.platform) {
    case 'win32':
      if (!process.env.USERPROFILE) throw new Error('USERPROFILE environment variable is not set.');
      return path.join(process.env.USERPROFILE, 'Documents', 'ComfyUI');
    case 'darwin':
      return path.join(homedir(), 'Documents', 'ComfyUI');
    default:
      return process.env.XDG_DOCUMENTS_DIR || path.join(homedir(), 'Documents', 'ComfyUI');
  }
}

export function addRandomSuffix(str: string) {
  return `${str}-${randomUUID().substring(0, 8)}`;
}

/**
 * Create a screenshot of the entire desktop.
 *
 * Hard-coded to 1920x1080 resolution.
 * @param filename - The name of the file to save the screenshot as.
 * @returns The path to the screenshot file.
 */
export async function createDesktopScreenshot(filename: string) {
  const width = 1920;
  const height = 1080;
  const powerShellScript = `
Add-Type -AssemblyName System.Drawing

$bounds = [Drawing.Rectangle]::FromLTRB(0, 0, ${width}, ${height})
$bmp = New-Object Drawing.Bitmap $bounds.width, $bounds.height
$graphics = [Drawing.Graphics]::FromImage($bmp)

$graphics.CopyFromScreen($bounds.Location, [Drawing.Point]::Empty, $bounds.size)
$bmp.Save("${filename}.png", "Png")

$graphics.Dispose()
$bmp.Dispose()
`;

  const process = exec(powerShellScript, { shell: 'powershell.exe' }, (error, stdout, stderr) => {
    if (error) console.error(error);
    if (stderr) console.error('Screenshot std error', stderr);
    if (stdout) console.log('Screenshot std out', stdout);
  });
  await new Promise((resolve) => process.on('close', resolve));

  const name = `${filename}.png`;
  return path.resolve(globalThis.process.cwd(), name);
}
