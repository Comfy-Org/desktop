import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { addRandomSuffix, pathExists } from 'tests/shared/utils';

import { expect, test } from '../testExtensions';

interface RendererElectronApi {
  electronAPI: {
    getBasePath: () => Promise<string>;
    DownloadManager: {
      startDownload: (url: string, directoryPath: string, filename: string) => Promise<boolean>;
    };
  };
}

test.describe('DownloadManager', () => {
  test('uses the provided absolute models directory without nesting it again', async ({ window, installedApp }) => {
    test.slow();

    await installedApp.waitUntilLoaded();

    const filename = `${addRandomSuffix('download-manager-regression')}.safetensors`;
    const fileContents = Buffer.from('playwright regression fixture');
    const server = createServer((request, response) => {
      if (request.url !== `/${filename}`) {
        response.writeHead(404);
        response.end('Not Found');
        return;
      }

      response.writeHead(200, {
        'Content-Length': String(fileContents.byteLength),
        'Content-Type': 'application/octet-stream',
      });
      response.end(fileContents);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error('Failed to determine local download server address');
    }

    let expectedFilePath = '';
    let nestedBrokenPath = '';
    try {
      const basePath = await window.evaluate(async () => {
        const api = (globalThis as typeof globalThis & RendererElectronApi).electronAPI;
        return await api.getBasePath();
      });
      const modelsDirectory = path.join(basePath, 'models');
      const absoluteTargetDirectory = path.join(modelsDirectory, 'checkpoints');
      expectedFilePath = path.join(absoluteTargetDirectory, filename);
      nestedBrokenPath = path.join(modelsDirectory, absoluteTargetDirectory, filename);
      const url = `http://127.0.0.1:${address.port}/${filename}`;

      await rm(expectedFilePath, { force: true });

      const started = await window.evaluate(
        async ({ directoryPath, filename, url }) => {
          const api = (globalThis as typeof globalThis & RendererElectronApi).electronAPI;
          return await api.DownloadManager.startDownload(url, directoryPath, filename);
        },
        {
          directoryPath: absoluteTargetDirectory,
          filename,
          url,
        }
      );

      expect(started).toBe(true);

      await expect
        .poll(
          async () => {
            if (!(await pathExists(expectedFilePath))) return null;
            const fileBuffer = await readFile(expectedFilePath);
            return fileBuffer.toString('utf8');
          },
          { timeout: 30 * 1000, intervals: [250] }
        )
        .toBe(fileContents.toString('utf8'));

      await expect
        .poll(async () => await pathExists(nestedBrokenPath), { timeout: 5 * 1000, intervals: [250] })
        .toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (expectedFilePath) {
        await rm(expectedFilePath, { force: true });
      }
      if (nestedBrokenPath && nestedBrokenPath !== expectedFilePath) {
        await rm(nestedBrokenPath, { force: true }).catch(() => undefined);
      }
    }
  });
});
