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

  if (os.platform() === 'darwin') {
    const venvPath = '/tmp/todesktop-python';
    console.log(`[ToDesktop macOS] Creating Python venv at ${venvPath} for node-gyp`);

    const venvResult = spawnSync('python3', ['-m', 'venv', venvPath], {
      shell: true,
      stdio: 'inherit',
    });
    if (venvResult.status !== 0) {
      console.error('[ToDesktop macOS] Failed to create venv; node-gyp may fail');
      return;
    }

    const pythonBin = path.join(venvPath, 'bin', 'python3');
    console.log(`[ToDesktop macOS] Using Python at ${pythonBin}`);

    console.log('[ToDesktop macOS] Python version check');
    spawnSync(pythonBin, ['--version'], { shell: true, stdio: 'inherit' });

    console.log('[ToDesktop macOS] Upgrading pip in venv');
    spawnSync(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip'], { shell: true, stdio: 'inherit' });

    console.log('[ToDesktop macOS] Installing setuptools and packaging (brings distutils)');
    spawnSync(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'setuptools', 'packaging'], {
      shell: true,
      stdio: 'inherit',
    });

    // Ensure downstream build tools (node-gyp) pick up this interpreter
    process.env.PYTHON = pythonBin;
    process.env.PATH = `${path.join(venvPath, 'bin')}:${process.env.PATH}`;

    console.log(`[ToDesktop macOS] PYTHON=${process.env.PYTHON}`);
    console.log(`[ToDesktop macOS] PATH=${process.env.PATH}`);
  }
};
