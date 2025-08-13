import axios from 'axios';
import fs from 'fs-extra';
import path from 'node:path';

async function downloadVCRedist() {
  const vcRedistDir = path.join('./assets', 'vcredist');
  const vcRedistPath = path.join(vcRedistDir, 'vc_redist.x64.exe');

  // Check if already downloaded
  if (fs.existsSync(vcRedistPath)) {
    console.log('< VC++ Redistributable already exists, skipping >');
    return;
  }

  // Ensure directory exists
  await fs.mkdir(vcRedistDir, { recursive: true });

  console.log('Downloading Visual C++ Redistributable...');
  const downloadedFile = await axios({
    method: 'GET',
    url: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
    responseType: 'arraybuffer',
  });

  fs.writeFileSync(vcRedistPath, downloadedFile.data);
  console.log('FINISHED DOWNLOADING VC++ REDISTRIBUTABLE');
}

// Download VC++ Redistributable
await downloadVCRedist();
