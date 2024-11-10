const { spawnSync } = require("child_process");
const path = require("path");
const os = require('os');
const process = require("process");
const fs = require('fs-extra');

async function postInstall() {
    const firstInstallOnToDesktopServers =
    process.env.TODESKTOP_CI && process.env.TODESKTOP_INITIAL_INSTALL_PHASE;

    if (!firstInstallOnToDesktopServers) return;

    console.log('After Yarn Install ' , os.platform());

    if (os.platform() === "win32")
    {
        // Change stdio to get back the logs if there are issues.
        const resultUpgradePip = spawnSync(`py`, ['-3.12', '-m', 'pip' ,'install' ,'--upgrade pip'],{shell:true,stdio: 'ignore'}).toString();
        const resultInstallComfyCLI = spawnSync(`py`, ['-3.12 ','-m' ,'pip' ,'install comfy-cli'], {shell:true,stdio: 'ignore'}).toString();
        const resultComfyManagerInstall = spawnSync('set PATH=C:\\hostedtoolcache\\windows\\Python\\3.12.7\\x64\\Scripts;%PATH% && yarn run make:assets:nvidia' ,[''],{shell:true,stdio: 'inherit'}).toString();
    }

    if (os.platform() == 'darwin')
    {
        // Python install pip and install comfy-cli
        const resultUpgradePip = spawnSync(`python3.12`, ['-m', 'pip', 'install', '--upgrade pip'], {
            shell: true,
            stdio: 'ignore',
            encoding: 'utf-8',
          });
        const resultInstallComfyCLI = spawnSync(`python3.12`, ['-m', 'pip', 'install comfy-cli'], {
            shell: true,
            stdio: 'inherit',
            encoding: 'utf-8',
          });
        // Finally add this python to path and then run the Assets Make for MacOS 
        const resultComfyManagerInstall = spawnSync('export PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:$PATH" && yarn run make:assets:macos', [''], {
            shell: true,
            stdio: 'inherit',
            encoding: 'utf-8',
          });
      
    }

    //TODO: Linux

    // Remove python stuff
    await fs.rm(path.join('./assets', 'python'), { recursive: true, force: true });
    await fs.rm(path.join('./assets', 'python.tgz'), { force: true });
    fs.readdirSync(path.join('./assets')).forEach((tgzFile) => {
      if (tgzFile.endsWith('.gz')) {
        fs.rmSync(path.join('./assets', tgzFile));
      }
    });

};

postInstall();
