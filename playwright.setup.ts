import { type FullConfig } from '@playwright/test';
import { spawn } from 'child_process';

async function globalSetup(config: FullConfig) {
  console.log('globalSetup');

  return new Promise<void>(async (resolve, reject) => {
    const electron = spawn('node', ['./scripts/launchdev.js']);

    electron.on('close', () => {
      reject('process failed to start');
    });

    electron.stdout.on('data', (data) => {
      if (data.indexOf('App ready') >= 0) {
        resolve();
      }
    });
  });
}

export default globalSetup;
