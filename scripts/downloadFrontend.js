const axios = require('axios');
const extract = require('extract-zip');
const fs = require('fs/promises');
const path = require('path');

// Example "v1.3.34"
const version = process.argv[2] || require('../package.json').config.frontendVersion;
if (!version) {
    console.error('No version specified');
    process.exit(1);
}

const url = `https://github.com/Comfy-Org/ComfyUI_frontend/releases/download/v${version}/dist.zip`;
const downloadPath = 'temp_frontend.zip';
const extractPath = 'assets/ComfyUI/web_custom_versions/desktop_app';

async function downloadAndExtractFrontend() {
    try {
        // Create directories if they don't exist
        await fs.mkdir(extractPath, { recursive: true });

        // Download the file
        console.log('Downloading frontend...');
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'arraybuffer'
        });

        // Save to temporary file
        await fs.writeFile(downloadPath, response.data);

        // Extract the zip file
        console.log('Extracting frontend...');
        await extract(downloadPath, { dir: path.resolve(extractPath) });

        // Clean up temporary file
        await fs.unlink(downloadPath);

        console.log('Frontend downloaded and extracted successfully!');
    } catch (error) {
        console.error('Error downloading frontend:', error.message);
        process.exit(1);
    }
}

downloadAndExtractFrontend();
