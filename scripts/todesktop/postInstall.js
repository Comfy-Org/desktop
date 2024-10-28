const { spawnSync } = require("child_process");
const path = require("path");
const os = require('os');
const process = require("process");
//const fs = require('fs-extra');

async function postInstall() {
    const firstInstallOnToDesktopServers =
    process.env.TODESKTOP_CI && process.env.TODESKTOP_INITIAL_INSTALL_PHASE;

    if (!firstInstallOnToDesktopServers) return;

    console.log('After Yarn Install' , os.platform());

    if (os.platform() === "win32")
    {
        // Change stdio to get back the logs if there are issues.
        const resultUpgradePip = spawnSync(`py`, ['-3.12', '-m', 'pip' ,'install' ,'--upgrade pip'],{shell:true,stdio: 'ignore'}).toString();
        const resultInstallComfyCLI = spawnSync(`py`, ['-3.12 ','-m' ,'pip' ,'install comfy-cli'], {shell:true,stdio: 'ignore'}).toString();
        console.log("Finish PIP & ComfyCLI Install");
        const resultComfyManagerInstall = spawnSync('set PATH=C:\\hostedtoolcache\\windows\\Python\\3.12.7\\x64\\Scripts;%PATH% && yarn run make:assets:nvidia' ,[''],{shell:true,stdio: 'inherit'}).toString();
        console.log("Finish Comfy Manager Install and Rehydration");
    }
};

postInstall();
