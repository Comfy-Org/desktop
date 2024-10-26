const { exec, execSync, spawnSync, spawn } = require("child_process");
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

    /*
    const firstInstallOnToDesktopServers =
    process.env.TODESKTOP_CI && process.env.TODESKTOP_INITIAL_INSTALL_PHASE;

    if (!firstInstallOnToDesktopServers) return;
*/

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

        const result7 = spawnSync('curl' ,['-s', 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe'],{shell:true,stdio: 'inherit'},execOutput).toString();
        console.log(result7);
        const result8 = spawnSync('python-3.12.7-amd64.exe', ['/quiet', 'InstallAllUsers=1','PrependPath=1', 'Include_test=0'],{shell:true,stdio: 'inherit'},execOutput).toString();
        console.log(result8);
        const result9 = execSync(`python --version`,execOutput).toString(); 
        console.log(result9);

        console.log("win ver");
        const result1 = execSync(`py -0`,execOutput).toString(); 
        console.log(result1);
        const result4 = spawnSync(`py`, ['-3.12', '-m', 'pip' ,'install' ,'--upgrade pip'],{shell:true,stdio: 'inherit'}).toString();
        console.log(result4);
        const result2 = spawnSync(`py`, ['-3.12 ','-m' ,'pip' ,'install comfy-cli'], {shell:true,stdio: 'inherit'}).toString();
        console.log(result2);
        console.log("finish pip");
        const result6 = spawnSync('setx /M PATH "C:\\hostedtoolcache\\windows\\Python\\3.12.7\\x64\\Scripts\\;%PATH%"',[''], {shell: true, stdio: 'inherit'});
        console.log(JSON.stringify(result6));
        const result3 = spawnSync('set PATH=C:\\hostedtoolcache\\windows\\Python\\3.12.7\\x64\\Scripts;%PATH% && cd assets && comfy-cli --skip-prompt --here install --fast-deps --nvidia --manager-url https://github.com/Comfy-Org/manager-core && comfy-cli --here standalone && mkdir -p ComfyUI/user/default' ,[''],{shell:true,stdio: 'inherit'}).toString();
        console.log(result3);
        const result5 = spawnSync('set PATH=C:\\hostedtoolcache\\windows\\Python\\3.12.7\\x64\\Scripts;%PATH% && cd assets && comfy-cli --here standalone' ,[''],{shell:true,stdio: 'inherit'}).toString();
        console.log(result5);
        const result = spawnSync('mkdir -p assets\\ComfyUI\\user\\default' ,[''],{shell:true,stdio: 'inherit'}).toString();
        console.log("finish yarn run");
        spawnSync('dir' ,[''],{shell:true,stdio: 'inherit'}).toString();
        spawnSync('cd assets && dir' ,[''],{shell:true,stdio: 'inherit'}).toString();
    }

    if (os.platform() === "darwin") {
        console.log("mac ver");
        
        const result = spawnSync('sh', [path.join(dirPath, 'scripts', 'signPython.sh')],{shell:true,stdio: 'inherit'}).toString();
       console.log(result); 
       console.log("finish python");
    }
};

postInstall();