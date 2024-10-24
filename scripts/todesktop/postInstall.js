const { exec, execSync } = require("child_process");
const path = require("path");
const os = require('os');
const process = require("process");

async function postInstall() {
    /**
 * pkgJsonPath - string - path to the package.json file
 * pkgJson - object - the parsed package.json file
 * appDir - string - the path to the app directory
 * hookName - string - the name of the hook ("todesktop:beforeInstall" or "todesktop:afterPack")
 */

    const firstInstallOnToDesktopServers =
    process.env.TODESKTOP_CI && process.env.TODESKTOP_INITIAL_INSTALL_PHASE;

    if (!firstInstallOnToDesktopServers) return;


    const execOutput = (error,stdout,stderr) => {
        console.log("exec out: " , stdout);
        console.log("exec stderr: " ,stderr);
        if (error !== null) {
            console.log(`exec error: ${error}`);
        }
    };

    const dirPath = process.cwd();
    console.log(dirPath);

    console.log(os.platform());

    if (os.platform() === "win32")
    {
        console.log("win ver");
        const result1 = execSync(`python --version`,execOutput).toString(); 
        console.log(result1);
        const result4 = execSync(`python -3.12 -m pip install --upgrade pip`).toString();
        console.log(result4);
        const result2 = execSync(`python -3.12 -m pip install comfy-cli`, execOutput).toString();
        console.log(result2);
        console.log("finish pip");
        const result3 = execSync(`yarn run make:assets:nvidia`, execOutput).toString();
        console.log(result3);
        console.log("finish yarn run");
    }

    if (os.platform() === "darwin") {
        console.log("mac ver");
        const result1 = execSync(`ls`, execOutput).toString();
        console.log(result1);
        const result = execSync(`export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin && sh ${path.join(dirPath, 'scripts', 'signPython.sh')}`, execOutput).toString();
        console.log("finish python");
    }
};

postInstall();