import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

async function globalSetup() {
  console.log('Playwright globalSetup called');

  return new Promise<void>((resolve, reject) => {
    // HACK: Force graphics card check to pass
    process.env.CI = '1';

    // Documents dir in CI
    if (!process.env.USERPROFILE) throw new Error('USERPROFILE not set');
    const documents = path.join(process.env.USERPROFILE, 'Documents');
    if (!existsSync(documents)) mkdirSync(documents);

    const electron = spawn('node', ['./scripts/launchCI.js']);

    electron.on('close', () => {
      reject(new Error('process failed to start'));
    });

    electron.stdout.on('data', (data: string | Buffer) => {
      if (data.includes('App ready')) {
        resolve();
      }
    });
  });
}

export default globalSetup;
