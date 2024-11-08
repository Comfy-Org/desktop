const { spawnSync } = require("child_process");
const path = require("path");
const os = require('os');
const uvVer = require('../package.json').config.uvVersion;
const fs = require('fs-extra');

async function downloadUV() {

    const uvDownloaded = fs.existsSync(path.join('./assets', 'uv'));
    if (!uvDownloaded)
    {
        const baseDownloadURL = `https://github.com/astral-sh/uv/releases/download/${uvVer}/`;
        const zipFolder = os.platform() == 'win32' ? 'uv-x86_64-pc-windows-msvc.zip' : os.platform() === 'darwin' ? 'uv-aarch64-apple-darwin.tar.gz' : 'uv-x86_64-unknown-linux-gnu.tar.gz';
        const outputUVFolder = path.join("uv", os.platform() === 'win32' ? 'win' : os.platform() === 'darwin' ?  'macos' : 'linux');
        fs.mkdirSync(path.join('./assets' ,outputUVFolder),{recursive:true});
        spawnSync(`cd ./assets/ && curl -O -J -L`, [`${baseDownloadURL}${zipFolder}`,`-o ${zipFolder}`],{shell:true,stdio: 'inherit', encoding: 'utf8'});
        spawnSync('cd ./assets/ && tar',['-xzvf', zipFolder,'-C', outputUVFolder ,os.platform() !== 'win32' && '--strip-components=1'],{shell:true,stdio: 'inherit', encoding: 'utf8'});
        fs.rmSync(path.join('./assets' ,zipFolder));
    }

};

downloadUV();
