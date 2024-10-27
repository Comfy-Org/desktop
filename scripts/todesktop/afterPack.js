const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');

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

  async function removeInvalidSymlinks(appPath) {
    const invalidSymlinksInManyLines = await new Promise((resolve, reject) => {
      exec(`find ${appPath} -type l ! -exec test -e {} \\; -print`, (error, stdout, stderr) => {
        console.log(`command: find ${appPath} -type l ! -exec test -e {} \\; -print`)
        if (error) {
          console.error(`error: ${error.message}`);
          return reject(error);
        }
        if (stderr) {
          console.log(`stderr: ${stderr}`);
          return reject(stderr);
        }
        console.log(`stdout: ${stdout}`);
        resolve(stdout);
      })
    });

    console.log("======invalidSymlinksInManyLines======")
    console.log(invalidSymlinksInManyLines)
    console.log("===========================")

    const invalidSymlinksInArray = invalidSymlinksInManyLines.split("\n")
      .map((invalidSymlink) => invalidSymlink.trim())
      .filter((maybeEmptyPath) => maybeEmptyPath !== '');

    console.log("======invalidSymlinksInArray======")
    console.log(invalidSymlinksInArray)
    console.log("===========================")

    const waitUntilAllInvalidSymlinksRemoved = invalidSymlinksInArray.map((invalidSymlink) => {
      return new Promise((resolve) => {
        exec(`rm ${invalidSymlink}`, (error, stdout, stderr) => {
          console.log(`command: rm ${invalidSymlink}`)

          if (error) {
            console.error(`error: ${error.message}`);
            return reject(error);
          }
          if (stderr) {
            console.log(`stderr: ${stderr}`);
            return reject(stderr);
          }
          console.log(`stdout: ${stdout}`);
          resolve(stdout);
        })
      })
    })

    try {
      await Promise.all(waitUntilAllInvalidSymlinksRemoved);
    } catch (e) {
      console.log(`error happened while removing all invalid symlinks. message: ${e.message}`);
    }

    return;
  }

  if (os.platform() === "darwin") {
    const appName = packager.appInfo.productFilename;
    const appPath = path.join(`${appOutDir}`, `${appName}.app`);
    const mainPath = path.dirname(outDir);
    const assetPath = path.join(mainPath, 'app-wrapper', 'app', 'assets');
    const resourcePath = path.join(appPath, "Contents", "Resources");
    const result = await fs.rm(path.join(assetPath, "ComfyUI", ".git"), { recursive: true, force: true });
    const result2 = await fs.cp(assetPath, resourcePath, { recursive: true });
    console.log("rm" , result);
    console.log("cp" , result2);
    await removeInvalidSymlinks(mainPath);
  }

  if (os.platform() === 'win32') {
    const appName = packager.appInfo.productFilename;
    const appPath = path.join(`${appOutDir}`, `${appName}.exe`);
    const mainPath = path.dirname(outDir);
    const assetPath = path.join(mainPath, 'app-wrapper', 'app', 'assets');
    const resourcePath = path.join(path.dirname(appPath), "resources");
    await fs.cp(assetPath, resourcePath, { recursive: true });
  }
}