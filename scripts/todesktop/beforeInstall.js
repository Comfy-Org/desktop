const { exec, execSync, spawnSync } = require("child_process");
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
        const result1 = spawnSync('curl' ,['-s', 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe'],{shell:true,stdio: 'inherit'},execOutput).toString();
        console.log(result1);
        const result2 = spawnSync('python-3.12.7-amd64.exe', ['/quiet', 'InstallAllUsers=1','PrependPath=1', 'Include_test=0'],{shell:true,stdio: 'inherit'},execOutput).toString();
        console.log(result2);
        const result3 = execSync(`python --version`,execOutput).toString(); 
        console.log(result3);
        
    }

    if (os.platform() === "darwin") {

    }
};