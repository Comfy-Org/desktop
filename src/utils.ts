import net from 'node:net';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import si from 'systeminformation';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import log from 'electron-log/main';
import type { GpuType } from './preload';

export const ansiCodes = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

export async function pathAccessible(path: string): Promise<boolean> {
  try {
    await fsPromises.access(path);
    return true;
  } catch {
    return false;
  }
}

export function getModelsDirectory(comfyUIBasePath: string): string {
  return path.join(comfyUIBasePath, 'models');
}

export function findAvailablePort(host: string, startPort: number, endPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    function tryPort(port: number) {
      if (port > endPort) {
        reject(new Error(`No available ports found between ${startPort} and ${endPort}`));
        return;
      }

      const server = net.createServer();
      server.listen(port, host, () => {
        server.once('close', () => {
          resolve(port);
        });
        server.close();
      });
      server.on('error', () => {
        tryPort(port + 1);
      });
    }

    tryPort(startPort);
  });
}

/**
 * Rotate old log files by adding a timestamp to the end of the file.
 * Removes old files.
 * @param logDir The directory to rotate the logs in.
 * @param baseName The base name of the log file.
 * @param maxFiles The maximum number of log files to keep. When 0, no files are removed. Default: 50
 */
export async function rotateLogFiles(logDir: string, baseName: string, maxFiles = 50) {
  const currentLogPath = path.join(logDir, `${baseName}.log`);

  try {
    await fsPromises.access(logDir, fs.constants.R_OK | fs.constants.W_OK);
    await fsPromises.access(currentLogPath);
  } catch {
    log.error('Log rotation: cannot access log dir.');
    // TODO: Report to user
    return;
  }

  // Remove the oldest file
  if (maxFiles > 0) {
    const files = await fsPromises.readdir(logDir, { withFileTypes: true });
    const names: string[] = [];

    const logFileRegex = new RegExp(`^${baseName}_\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z\\.log$`);

    for (const file of files) {
      if (file.isFile() && logFileRegex.test(file.name)) names.push(file.name);
    }
    if (names.length > maxFiles) {
      names.sort();
      await fsPromises.unlink(path.join(logDir, names[0]));
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const newLogPath = path.join(logDir, `${baseName}_${timestamp}.log`);
  await fsPromises.rename(currentLogPath, newLogPath);
}

const execAsync = promisify(exec);

interface HardwareValidation {
  isValid: boolean;
  /** The detected GPU (not guaranteed to be valid - check isValid) */
  gpu?: GpuType;
  error?: string;
}

/**
 * Validate the system hardware requirements for ComfyUI.
 */
export async function validateHardware(): Promise<HardwareValidation> {
  try {
    // Only ARM Macs are supported.
    if (process.platform === 'darwin') {
      const cpu = await si.cpu();
      const isArmMac = cpu.manufacturer === 'Apple';

      if (!isArmMac) {
        return {
          isValid: false,
          error: 'ComfyUI requires Apple Silicon (M1/M2/M3) Mac. Intel-based Macs are not supported.',
        };
      }

      return { isValid: true, gpu: 'mps' };
    }

    // Windows NVIDIA GPU validation
    if (process.platform === 'win32') {
      const graphics = await si.graphics();
      const hasNvidia = graphics.controllers.some((controller) => controller.vendor.toLowerCase().includes('nvidia'));

      if (process.env.CI) {
        return { isValid: true }; // Temporary workaround for testing with Playwright
      }

      if (!hasNvidia) {
        try {
          // wmic is unreliable. Check in PS.
          const res = await execAsync(
            'powershell.exe -c "$n = \'*NVIDIA*\'; Get-CimInstance win32_videocontroller | ? { $_.Name -like $n -or $_.VideoProcessor -like $n -or $_.AdapterCompatibility -like $n }"'
          );
          if (!res?.stdout) throw new Error('No video card');
        } catch {
          try {
            await execAsync('nvidia-smi');
          } catch {
            return {
              isValid: false,
              error: 'ComfyUI requires an NVIDIA GPU on Windows. No NVIDIA GPU was detected.',
            };
          }
        }
      }

      return { isValid: true, gpu: 'nvidia' };
    }

    return {
      isValid: false,
      error: 'ComfyUI currently supports only Windows (NVIDIA GPU) and Apple Silicon Macs.',
    };
  } catch (error) {
    log.error('Error validating hardware:', error);
    return {
      isValid: false,
      error: 'Failed to validate system hardware requirements. Please check the logs for more details.',
    };
  }
}
