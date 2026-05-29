import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { addRandomSuffix, pathExists } from 'tests/shared/utils';

import { TempDirectory } from '../tempDirectory';
import { expect, test } from '../testExtensions';

interface RendererElectronApi {
  electronAPI: {
    getBasePath: () => Promise<string>;
  };
}

test.describe('Missing Model Download UI', () => {
  test('shows active status immediately for Electron missing-model downloads', async ({ window, installedApp }) => {
    test.slow();

    await installedApp.waitUntilLoaded();

    const filename = `${addRandomSuffix('missing-model-ui')}.safetensors`;
    const fileContents = Buffer.from('missing model ui regression fixture');
    const workflow = {
      last_node_id: 0,
      last_link_id: 0,
      nodes: [],
      links: [],
      groups: [],
      config: {},
      extra: {
        ds: {
          scale: 1,
          offset: [0, 0],
        },
      },
      models: [
        {
          name: filename,
          url: '',
          directory: 'checkpoints',
        },
      ],
      version: 0.4,
    };

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

      const timer = setTimeout(() => {
        response.end(fileContents);
      }, 1000);

      response.once('close', () => clearTimeout(timer));
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

    await using workflowDirectory = new TempDirectory();

    let workflowPath = '';
    let expectedFilePath = '';
    try {
      await mkdir(workflowDirectory.path, { recursive: true });
      workflow.models[0].url = `http://127.0.0.1:${address.port}/${filename}`;

      workflowPath = path.join(workflowDirectory.path, `${filename}.json`);
      await writeFile(workflowPath, JSON.stringify(workflow, null, 2), {
        flush: true,
      });

      const basePath = await window.evaluate(async () => {
        const api = (globalThis as typeof globalThis & RendererElectronApi).electronAPI;
        return await api.getBasePath();
      });

      expectedFilePath = path.join(basePath, 'models', 'checkpoints', filename);
      await rm(expectedFilePath, { force: true });

      await window.locator('#comfy-file-input').setInputFiles(workflowPath);

      const errorOverlay = window.locator('[data-testid="error-overlay"]');
      const rowDownloadButton = errorOverlay.getByRole('button', {
        name: `Download ${filename}`,
      });

      await expect(errorOverlay).toBeVisible();
      await expect(errorOverlay.getByText(/Missing Models/)).toBeVisible();
      await expect(rowDownloadButton).toBeVisible();

      await rowDownloadButton.click();

      await expect(rowDownloadButton).not.toBeVisible();
      await expect(errorOverlay.getByText(/importing/i)).toBeVisible();

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

      await expect(errorOverlay.getByText(/imported/i)).toBeVisible();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (expectedFilePath) {
        await rm(expectedFilePath, { force: true });
      }
    }
  });
});
