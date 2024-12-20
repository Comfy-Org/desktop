import { spawn } from 'node:child_process';

async function globalSetup() {
  console.log('Playwright globalSetup called');

  return new Promise<void>((resolve, reject) => {
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
