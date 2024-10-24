const { exec, execSync } = require("child_process");
const path = require("path");
const os = require('os');

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

    const dirPath = pkgJsonPath.replace("package.json", "");

    console.log(os.platform());

    if (os.platform() === "win32")
    {
        console.log("win ver");
        const result1 = execSync(`python --version`,execOutput); 
        console.log(result1);
        const result2 = execSync(`python -3.1 -m pip install comfy-cli`, execOutput);
        console.log(result2);
        console.log("finish pip");
        const result3 = execSync(`yarn run make:assets:nvidia`, execOutput);
        console.log(result3);
        console.log("finish yarn run");
    }

    if (os.platform() === "darwin") {
        console.log("mac ver");
        const result1 = execSync(`ls`, execOutput);
        console.log(result1);
        const result = execSync(`sh ${path.join(dirPath, 'scripts', 'signPython.sh')}`, execOutput);
        console.log("finish python");
    }
};