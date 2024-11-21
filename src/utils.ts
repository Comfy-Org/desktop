import * as net from 'net';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import fs from 'fs';

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
 * @param logDir The directory to rotate the logs in.
 * @param baseName The base name of the log file.
 */
export function rotateLogFiles(logDir: string, baseName: string) {
  const currentLogPath = path.join(logDir, `${baseName}.log`);
  if (fs.existsSync(currentLogPath)) {
    const stats = fs.statSync(currentLogPath);
    const timestamp = stats.birthtime.toISOString().replace(/[:.]/g, '-');
    const newLogPath = path.join(logDir, `${baseName}_${timestamp}.log`);
    fs.renameSync(currentLogPath, newLogPath);
  }
}
