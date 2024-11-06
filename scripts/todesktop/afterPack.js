const os = require('os');
const fs = require('fs/promises');
const path = require('path');

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

  // The purpose of this script is to move the built python and comfy files from assets to the resource folder of the app
  // We can not add them to extraFiles as that is done prior to building, where we need to move them AFTER

  if (os.platform() === "darwin") {
    const appName = packager.appInfo.productFilename;
    const appPath = path.join(`${appOutDir}`, `${appName}.app`);
    const mainPath = path.dirname(outDir);
    const assetPath = path.join(mainPath, 'app-wrapper', 'app', 'assets');
    const resourcePath = path.join(appPath, "Contents", "Resources");
    const result = await fs.rm(path.join(assetPath, "ComfyUI", ".git"), { recursive: true, force: true });
    const result3 = await fs.rm(path.join(assetPath, "ComfyUI", 'custom_nodes', 'ComfyUI_Manager', ".git"), { recursive: true, force: true });
    const result4 = await fs.rm(path.join(assetPath, "ComfyUI", 'custom_nodes', 'DesktopSettingsExtension', ".git"), { recursive: true, force: true });
    const result2 = await fs.cp(assetPath, resourcePath, { recursive: true });
    await fs.rm(path.join(resourcePath, 'uv', 'win'), { recursive: true, force: true });
    await fs.rm(path.join(resourcePath, 'uv', 'linux'), { recursive: true, force: true });
  }

  if (os.platform() === 'win32') {
    const appName = packager.appInfo.productFilename;
    const appPath = path.join(`${appOutDir}`, `${appName}.exe`);
    const mainPath = path.dirname(outDir);
    const assetPath = path.join(mainPath, 'app-wrapper', 'app', 'assets');
    const resourcePath = path.join(path.dirname(appPath), "resources");
    await fs.cp(assetPath, resourcePath, { recursive: true });
    try {
      await fs.rm(path.join(resourcePath, 'uv', 'macos'), { recursive: true, force: true });
      await fs.rm(path.join(resourcePath, 'uv', 'linux'), { recursive: true, force: true });
      await fs.rm(path.join(resourcePath, 'python.tgz'), { recursive: true, force: true });
      await fs.rm(path.join(resourcePath, 'pyhton'), { recursive: true, force: true });
    } catch (error) {

    }

  }
}
