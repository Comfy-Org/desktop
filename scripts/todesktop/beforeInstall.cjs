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
    const pythonMajorMinor = '3.13';
    const pythonFormula = 'python@3.13';
    const expectedPrefix = `Python ${pythonMajorMinor}`;
    const pythonFrameworkBin = `/Library/Frameworks/Python.framework/Versions/${pythonMajorMinor}/bin/python3`;
    const venvPath = '/tmp/todesktop-python';

    const versionMatches = (bin) => {
      const result = spawnSync(bin, ['--version'], { shell: true, encoding: 'utf8' });
      const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
      return result.status === 0 && output.startsWith(expectedPrefix);
    };

    const resolvePython313 = () => {
      const candidates = [process.env.PYTHON_3_13, pythonFrameworkBin, '/opt/homebrew/bin/python3.13', '/usr/local/bin/python3.13', 'python3.13'];
      for (const bin of candidates) {
        if (bin && versionMatches(bin)) return bin;
      }
      return null;
    };

    let pythonBin = resolvePython313();

    if (!pythonBin) {
      console.log(`[ToDesktop macOS] Installing Python ${pythonMajorMinor}.x with Homebrew (${pythonFormula})`);
      const brewAvailable = spawnSync('brew', ['--version'], { shell: true, stdio: 'ignore' }).status === 0;
      if (!brewAvailable) {
        console.error('[ToDesktop macOS] Homebrew not available; cannot install python@3.13');
        return;
      }

      const brewResult = spawnSync('brew', ['install', pythonFormula], { shell: true, stdio: 'inherit' });
      if (brewResult.status !== 0) {
        console.error('[ToDesktop macOS] Failed to install python@3.13 with Homebrew');
        return;
      }

      const prefixResult = spawnSync('brew', ['--prefix', pythonFormula], { shell: true, encoding: 'utf8' });
      const prefix = prefixResult.stdout && prefixResult.stdout.trim();
      const brewBin = prefix ? path.join(prefix, 'bin', 'python3.13') : null;
      if (brewBin && versionMatches(brewBin)) pythonBin = brewBin;
      if (!pythonBin) pythonBin = resolvePython313();
    }

    if (!pythonBin) {
      console.error('[ToDesktop macOS] Python 3.13 not found after installation attempts');
      return;
    }

    console.log(`[ToDesktop macOS] Using Python at ${pythonBin}`);
    spawnSync(pythonBin, ['--version'], { shell: true, stdio: 'inherit' });

    console.log(`[ToDesktop macOS] Creating Python ${pythonMajorMinor} venv at ${venvPath} for node-gyp`);
    const venvResult = spawnSync(pythonBin, ['-m', 'venv', venvPath], { shell: true, stdio: 'inherit' });
    if (venvResult.status !== 0) {
      console.error('[ToDesktop macOS] Failed to create venv; node-gyp may fail');
      return;
    }

    const pythonVenvBin = path.join(venvPath, 'bin', 'python3');

    console.log('[ToDesktop macOS] Upgrading pip in venv');
    spawnSync(pythonVenvBin, ['-m', 'pip', 'install', '--upgrade', 'pip'], { shell: true, stdio: 'inherit' });

    console.log('[ToDesktop macOS] Installing setuptools and packaging (brings distutils)');
    spawnSync(pythonVenvBin, ['-m', 'pip', 'install', '--upgrade', 'setuptools', 'packaging'], {
      shell: true,
      stdio: 'inherit',
    });

    process.env.PYTHON = pythonVenvBin;
    process.env.PATH = `${path.join(venvPath, 'bin')}:${process.env.PATH}`;

    console.log(`[ToDesktop macOS] PYTHON=${process.env.PYTHON}`);
    console.log(`[ToDesktop macOS] PATH=${process.env.PATH}`);
  }
};
