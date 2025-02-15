import { rename } from 'node:fs/promises';

import { FilePermission, addRandomSuffix, getComfyUIAppDataPath, pathExists } from './tests/shared/utils';

/** Backs up app data - in case this was run on a non-ephemeral machine.  Does nothing in CI. */
async function globalSetup() {
  console.log('+ Playwright globalSetup called');
  if (process.env.CI) return;

  const appDataPath = getComfyUIAppDataPath();
  await backupByRenaming(appDataPath);
}

/** Backs up a the provided app data path by appending a random suffix. */
async function backupByRenaming(appDataPath: string) {
  if (!(await pathExists(appDataPath, FilePermission.Writable))) return;

  const newPath = addRandomSuffix(appDataPath);
  console.warn(`AppData exists! Moving ${appDataPath} to ${newPath}. Remove manually if you do not require it.`);
  await rename(appDataPath, newPath);
  return newPath;
}

export default globalSetup;
