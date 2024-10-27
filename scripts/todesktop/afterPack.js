const os = require('os');
const fs = require('fs/promises');
const path = require('path');

module.exports = async ({ appOutDir, packager,outDir }) => {
  /**
    * appPkgName - string - the name of the app package
    * appId - string - the app id
    * shouldCodeSign - boolean - whether the app will be code signed or not
    * outDir - string - the path to the output directory
    * appOutDir - string - the path to the app output directory
    * packager - object - the packager object
    * arch - number - the architecture of the app. ia32 = 0, x64 = 1, armv7l = 2, arm64 = 3, universal = 4.
  */

  if (os.platform() === "darwin") {
    const appName = packager.appInfo.productFilename;
    const appPath = path.join(`${appOutDir}`, `${appName}.app`);
    const mainPath = path.dirname(outDir);
    const assetPath = path.join(mainPath,'app-wrapper','app','assets');
    const resourcePath = path.join(appPath,"Contents","Resources");
    await fs.rm(path.join(assetPath,"ComfyUI",".git"),{recursive:true,force:true});
    await fs.cp(assetPath, resourcePath, {recursive: true});
  }

  if (os.platform() === 'win32')
  {
    const appName = packager.appInfo.productFilename;
    const appPath = path.join(`${appOutDir}`, `${appName}.exe`);
    const mainPath = path.dirname(outDir);
    const assetPath = path.join(mainPath,'app-wrapper','app','assets');
    const resourcePath = path.join(path.dirname(appPath),"resources");
    await fs.cp(assetPath, resourcePath, {recursive: true});
  }
}