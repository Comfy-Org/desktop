const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = async ({ appOutDir, packager, outDir }) => {
  /**
   * appPkgName - string - the name of the app package
   * appId - string - the app id
   * shouldCodeSign - boolean - whether the app will be code signed or not
   * outDir - string - the path to the output directory
   * appOutDir - string - the path to the app output directory
   * packager - object - the packager object
   * arch - number - the architecture of the app. ia32 = 0, x64 = 1, armv7l = 2, arm64 = 3, universal = 4.
   */

  // The purpose of this script is to move comfy files from assets to the resource folder of the app
  // We can not add them to extraFiles as that is done prior to building, where we need to move them AFTER

  if (os.platform() === 'darwin') {
    const appName = packager.appInfo.productFilename;
    const appPath = path.join(`${appOutDir}`, `${appName}.app`);
    const mainPath = path.dirname(outDir);
    const assetPath = path.join(mainPath, 'app-wrapper', 'app', 'assets');
    const nodeModulesPath = path.join(mainPath, 'app-wrapper', 'app', 'node_modules');
    const resourcePath = path.join(appPath, 'Contents', 'Resources');
    // Remove these Git folders that mac's codesign is choking on. Need a more recursive way to just find all folders with '.git' and delete
    await fs.rm(path.join(assetPath, 'ComfyUI', '.git'), { recursive: true, force: true });
    await fs.rm(path.join(assetPath, 'ComfyUI', 'custom_nodes', 'ComfyUI-Manager', '.git'), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(assetPath, 'ComfyUI', 'custom_nodes', 'DesktopSettingsExtension', '.git'), {
      recursive: true,
      force: true,
    });
    // Move rest of items to the resource folder
    await fs.cp(assetPath, resourcePath, { recursive: true });
    await fs.cp(nodeModulesPath, path.join(resourcePath, 'node_modules'), { recursive: true });
    // Remove other OS's UV
    await fs.rm(path.join(resourcePath, 'uv', 'win'), { recursive: true, force: true });
    await fs.rm(path.join(resourcePath, 'uv', 'linux'), { recursive: true, force: true });
    await fs.chmod(path.join(resourcePath, 'uv', 'macos', 'uv'), '755');
    await fs.chmod(path.join(resourcePath, 'uv', 'macos', 'uvx'), '755');
    // Ensure node-pty spawn helpers are executable on macOS
    const nodePtyPath = path.join(resourcePath, 'node_modules', 'node-pty');
    for (const arch of ['darwin-arm64', 'darwin-x64']) {
      const helper = path.join(nodePtyPath, 'prebuilds', arch, 'spawn-helper');
      try {
        await fs.chmod(helper, '755');
      } catch (error) {
        console.warn(`Failed to chmod ${helper}:`, error);
      }
    }
  }

  if (os.platform() === 'win32') {
    const appName = packager.appInfo.productFilename;
    const appPath = path.join(`${appOutDir}`, `${appName}.exe`);
    const mainPath = path.dirname(outDir);
    const assetPath = path.join(mainPath, 'app-wrapper', 'app', 'assets');
    const nodeModulesPath = path.join(mainPath, 'app-wrapper', 'app', 'node_modules');
    const resourcePath = path.join(path.dirname(appPath), 'resources');
    // Move rest of items to the resource folder
    await fs.cp(assetPath, resourcePath, { recursive: true });
    await fs.cp(nodeModulesPath, path.join(resourcePath, 'node_modules'), { recursive: true });
    // Remove other OS's UV
    await fs.rm(path.join(resourcePath, 'uv', 'macos'), { recursive: true, force: true });
    await fs.rm(path.join(resourcePath, 'uv', 'linux'), { recursive: true, force: true });
  }

  //TODO: Linux
};
