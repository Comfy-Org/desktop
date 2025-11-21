const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

module.exports = async ({ pkgJsonPath, pkgJson, appDir, hookName }) => {
  /**
   * pkgJsonPath - string - path to the package.json file
   * pkgJson - object - the parsed package.json file
   * appDir - string - the path to the app directory
   * hookName - string - the name of the hook ("todesktop:beforeInstall" or "todesktop:afterPack")
   */

  console.log('Before Yarn Install', os.platform());

  // Ensure the Yarn version defined in packageManager is available (Corepack is bundled with Node).
  const yarnVersion = pkgJson?.packageManager?.startsWith('yarn@')
    ? pkgJson.packageManager.split('@')[1]
    : null;
  if (yarnVersion) {
    console.log(`Ensuring corepack uses yarn@${yarnVersion}`);
    const enableResult = spawnSync('corepack', ['enable'], { shell: true, stdio: 'inherit' });
    if (enableResult.status !== 0) {
      console.warn('corepack enable failed; install may still pick up a global Yarn');
    }
    const prepareResult = spawnSync('corepack', ['prepare', `yarn@${yarnVersion}`, '--activate'], {
      shell: true,
      stdio: 'inherit',
    });
    if (prepareResult.status !== 0) {
      console.warn(`corepack prepare yarn@${yarnVersion} failed; install may still pick up a global Yarn`);
    }
  }

  if (os.platform() === 'win32') {
    // ToDesktop currently does not have the min 3.12 python installed.
    // Download the installer then install it
    // Change stdio to get back the logs if there are issues.
    spawnSync('curl', ['-s', 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe'], {
      shell: true,
      stdio: 'ignore',
    });
    spawnSync('python-3.12.7-amd64.exe', ['/quiet', 'InstallAllUsers=1', 'PrependPath=1', 'Include_test=0'], {
      shell: true,
      stdio: 'ignore',
    });
  }
};
