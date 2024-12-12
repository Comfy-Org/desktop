const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const util = require('node:util');
const fs = require('fs/promises');

const execFile = util.promisify(require('node:child_process').execFile);

const gitUrl = 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe';
const gitFilename = './Git-2.47.1-64-bit.exe';

/**
 * Check if {@link command} (executable, shell script, etc) is valid in the current .env.
 * @param {string} command The command (executable, script, etc) to check, e.g. `git`
 * @returns `true` if running {@link command} in a regular shell environment
 * is a valid command, otherwise `false`
 * @throws {Error} When executed anywere but `win32`.
 */
async function isValidCommand(command) {
  if (os.platform() !== 'win32') throw Error('Not implemented.');

  try {
    await execFile('where.exe', [command]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads a file
 * @param {string} url
 * @param {string | undefined} filename Installer file name
 * @returns `true` on success, `false` on any failure
 */
async function downloadFile(url, filename) {
  const out = filename ?? url.split('/').at(-1);
  try {
    await execFile('curl.exe', ['-s', '-L', url, '-o', `./${out}`]);
    return true;
  } catch (error) {
    console.error(`downloadFile failed: ${error.stderr}`, error);
    return false;
  }
}

/**
 * Tries to remove a file from the filesystem
 * @param {string} filename The file to delete
 */
async function tryDeleteFile(filename) {
  try {
    await fs.unlink(filename);
  } catch (error) {
    console.warn(`Unable to remove file [${filename}]: ${error.stderr}`, error);
  }
}

/**
 * Downloads and installs git, if not present in path.
 */
async function ensureGitPresent() {
  if (await isValidCommand('git')) return;
  if (!(await downloadFile(gitUrl))) return;

  // Install
  try {
    await execFile(gitFilename, ['/verysilent', '/suppressmsgboxes', '/log', '/norestart', '/restartapplications']);
  } catch (error) {
    console.error(`git install attempt reported the following error: ${error.stderr}`, error);
  }

  // Remove installer
  await tryDeleteFile(gitFilename);
}

/**
 * @param {string} pkgJsonPath path to the package.json file
 * @param {object} pkgJson the parsed package.json file
 * @param {string} appDir the path to the app directory
 * @param {string} hookName the name of the hook ("todesktop:beforeInstall" or "todesktop:afterPack")
 */
module.exports = async ({ pkgJsonPath, pkgJson, appDir, hookName }) => {
  console.log('Before Yarn Install', os.platform());

  if (os.platform() === 'win32') {
    // ToDesktop currently does not have the min 3.12 python installed.
    // Download the installer then install it
    // Change stdio to get back the logs if there are issues.
    const result1 = spawnSync('curl', ['-s', 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe'], {
      shell: true,
      stdio: 'ignore',
    }).toString();
    const result2 = spawnSync(
      'python-3.12.7-amd64.exe',
      ['/quiet', 'InstallAllUsers=1', 'PrependPath=1', 'Include_test=0'],
      { shell: true, stdio: 'ignore' }
    ).toString();

    // TODO: Move to the installer, if current dist infra permits it
    // Download git
    await ensureGitPresent();
  }
};
