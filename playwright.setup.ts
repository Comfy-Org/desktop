import { spawn } from 'node:child_process';

async function globalSetup() {
  console.log('Playwright globalSetup called');

  return new Promise<void>((resolve, reject) => {
    const electron = spawn('node', ['./scripts/launchCI.js']);

    electron.on('close', () => {
      reject(new Error('process failed to start'));
    });

    electron.stderr.on('data', (data: string | Buffer) => {
      console.error('Electron error:', data.toString());
    });

    electron.stdout.on('data', (data: string | Buffer) => {
      console.log('Electron output:', data.toString());
      if (data.includes('App ready')) {
        resolve();
      }
    });
  });
}

export default globalSetup;
