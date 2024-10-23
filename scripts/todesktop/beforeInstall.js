const { exec } = require("child_process");
const path = require("path");

module.exports = async ({ pkgJsonPath, pkgJson, appDir, hookName }) => {
    /**
 * pkgJsonPath - string - path to the package.json file
 * pkgJson - object - the parsed package.json file
 * appDir - string - the path to the app directory
 * hookName - string - the name of the hook ("todesktop:beforeInstall" or "todesktop:afterPack")
 */

    if (process.platform === "darwin") {
        const result = exec(`sh ${path.join(appDir, 'scripts', 'signPyhton.sh')}`, (error, stdout, stderr) => {
            console.log(stdout);
            console.log(stderr);
            if (error !== null) {
                console.log(`exec error: ${error}`);
            }
        });
    }
};