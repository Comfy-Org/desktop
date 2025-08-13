const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const axios = require('axios');

async function downloadVCRedist() {
  const vcredistDir = path.join('build', 'vcredist');
  const vcredistPath = path.join(vcredistDir, 'vc_redist.x64.exe');

  // Check if already downloaded
  if (fs.existsSync(vcredistPath)) {
    console.log('< VC++ Redistributable already exists, skipping >');
    return;
  }

  // Ensure directory exists
  await fs.promises.mkdir(vcredistDir, { recursive: true });

  console.log('Downloading Visual C++ Redistributable...');
  const response = await axios({
    method: 'GET',
    url: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
    responseType: 'arraybuffer',
  });

  fs.writeFileSync(vcredistPath, response.data);
  console.log('FINISHED DOWNLOADING VC++ REDISTRIBUTABLE');
}

module.exports = async ({ pkgJsonPath, pkgJson, appDir, hookName }) => {
  /**
   * pkgJsonPath - string - path to the package.json file
   * pkgJson - object - the parsed package.json file
   * appDir - string - the path to the app directory
   * hookName - string - the name of the hook ("todesktop:beforeInstall" or "todesktop:afterPack")
   */

  console.log('Before Yarn Install', os.platform());

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

    // Download VC++ redistributable for Windows installer
    await downloadVCRedist();
  }
};
