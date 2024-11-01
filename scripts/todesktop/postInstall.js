const { spawnSync } = require("child_process");
const path = require("path");
const os = require('os');
const process = require("process");

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

    if (os.platform() === "darwin") {

        const resultUpgradePip = spawnSync(`python3`, ['-m', 'pip' ,'install' ,'--upgrade pip'],{shell:true,stdio: 'ignore'});
        const resultInstallComfyCLI = spawnSync(`python3`, ['-m' ,'pip' ,'install comfy-cli'], {shell:true,stdio: 'ignore'});
        const resultComfyManagerInstall = spawnSync('yarn run make:assets:macos' ,[''],{shell:true,stdio: 'inherit'});

        // Do not delete, useful if there are build issues with mac
        // TODO: Consider making a global build log as ToDesktop logs can be hit or miss
        /*
        const fs = require('fs-extra');
        fs.createFileSync('./.vite/macpip.json');
        fs.writeFileSync('./.vite/macpip.json',JSON.stringify({
            upgradeOut: {
            log: resultUpgradePip.stdout?.toString(),
            err:resultUpgradePip.stderr?.toString()},
            installComfOut: {
                log: resultInstallComfyCLI.stdout?.toString(),
                err:resultInstallComfyCLI.stderr?.toString()
            },
            ComfManInstallOut: {
                log: resultComfyManagerInstall.stdout?.toString(),
                err:resultComfyManagerInstall.stderr?.toString()
            }
        }));
        */
      console.log("Finish Python & Comfy Install for Mac");
    }
};

postInstall();
