const { spawnSync } = require("child_process");
const path = require("path");
const os = require('os');

module.exports = async ({ pkgJsonPath, pkgJson, appDir, hookName }) => {
    /**
 * pkgJsonPath - string - path to the package.json file
 * pkgJson - object - the parsed package.json file
 * appDir - string - the path to the app directory
 * hookName - string - the name of the hook ("todesktop:beforeInstall" or "todesktop:afterPack")
 */

    console.log('Before Yarn Install' , os.platform());

    if (os.platform() === "win32")
    {
        // ToDesktop currently does not have the min 3.12 python installed. 
        // Download the installer then install it
        // Change stdio to get back the logs if there are issues.
        const result1 = spawnSync('curl' ,['-s', 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe'],{shell:true,stdio: 'ignore'}).toString();
        const result2 = spawnSync('python-3.12.7-amd64.exe', ['/quiet', 'InstallAllUsers=1','PrependPath=1', 'Include_test=0'],{shell:true,stdio: 'ignore'}).toString();
    }
};