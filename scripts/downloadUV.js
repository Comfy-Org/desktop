import path from "path"
import os from 'os'
import * as fs from 'fs-extra'
import * as axios from 'axios'
import * as tar from 'tar'
import * as extractZip from 'extract-zip'
import packageJson from './getPackage.js'

const uvVer = packageJson.config.uvVersion;

const options = {
    win32: {
        zipFile: 'uv-x86_64-pc-windows-msvc.zip',
        uvOutputFolderName: 'win',
        zip: true,
    },
    darwin: {
        zipFile: 'uv-aarch64-apple-darwin.tar.gz',
        uvOutputFolderName: 'macos',
        zip: false,
    },
    linux: {
        zipFile: 'uv-x86_64-unknown-linux-gnu.tar.gz',
        uvOutputFolderName: 'linux',
        zip: false,
    }
}

async function downloadUV() {
  
  const allFlag = process.argv[2];
  const baseDownloadURL = `https://github.com/astral-sh/uv/releases/download/${uvVer}/`;
  if (allFlag)
  {
      if (allFlag === 'all') {
          await downloadAndExtract(baseDownloadURL, options.win32);
          await downloadAndExtract(baseDownloadURL, options.darwin);
          await downloadAndExtract(baseDownloadURL, options.linux);
          return;
      }
      if (allFlag === 'none') {
          return;
      }
  }

  const uvDownloaded = fs.existsSync(path.join('./assets', 'uv'));
  if (!uvDownloaded) {
      await downloadAndExtract(baseDownloadURL, options[os.platform()]);
      return;
  }
  console.log('< UV Folder Exists, Skipping >');

};

async function downloadAndExtract(baseURL, options) {
    const {
        zipFile,
        uvOutputFolderName,
        zip
    } = options;
    const zipFilePath = path.join('./assets', zipFile);
    const outputUVFolder = path.join('./assets', 'uv', uvOutputFolderName);
    await fs.mkdir(outputUVFolder, {
        recursive: true
    });
    const downloadedFile = await axios({
        method: 'GET',
        url: baseURL + zipFile,
        responseType: 'arraybuffer'
    });
    fs.writeFileSync(zipFilePath, downloadedFile.data);
    zip ? await extractZip(zipFilePath, {
        dir: path.resolve(outputUVFolder)
    }) : tar.extract({
        sync: true,
        file: zipFilePath,
        C: outputUVFolder,
        "strip-components": 1
    });
    await fs.unlink(zipFilePath);
    console.log(`FINISHED DOWNLOAD AND EXTRACT UV ${uvOutputFolderName}`);
}

//** Download and Extract UV. Default uses OS.Platfrom. Add 'all' will download all. Add 'none' will skip */
downloadUV();
