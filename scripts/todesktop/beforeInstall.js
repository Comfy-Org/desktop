const { exec } = require("child_process");
const path = require("path");

module.exports = async ({ pkgJsonPath, pkgJson, appDir, hookName }) => {
    /**
 * pkgJsonPath - string - path to the package.json file
 * pkgJson - object - the parsed package.json file
 * appDir - string - the path to the app directory
 * hookName - string - the name of the hook ("todesktop:beforeInstall" or "todesktop:afterPack")
 */

    const execOutput = (error,stdout,stderr) => {
        console.log("exec out: " , stdout);
        console.log("exec stderr: " ,stderr);
        if (error !== null) {
            console.log(`exec error: ${error}`);
        }
    };

    if (process.platform === "win32")
    {
        exec(`set -x`, execOutput);
        exec(`pip install comfy-cli`, execOutput);
        exec(`yarn run make:assets:nvidia`, execOutput);
    }

    if (process.platform === "darwin") {
        const result = exec(`sh ${path.join(appDir, 'scripts', 'signPyhton.sh')}`, execOutput);
    }
};