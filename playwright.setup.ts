import { chromium, type FullConfig } from '@playwright/test';
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

async function globalSetup(config: FullConfig) {
  console.log('globalSetup');

  return new Promise<void>(async (resolve, reject) => {
    const electron = spawn('node', ['./scripts/launchdev.js']);

    if (electron.pid) {
      writeFileSync('.electron.pid', electron.pid?.toString());
    }

    electron.on('close', () => {
      reject('process failed to start');
    });

    electron.stdout.on('data', (data) => {
      if (data.indexOf('App ready') >= 0) {
        resolve();
      }
    });

    // electron.stderr.on('data', (data) => {
    //     reject(`${data}`)
    //   });
  });
}

export default globalSetup;
