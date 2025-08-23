import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const targetDir = path.resolve(rootDir, '../ComfyUI_frontend/node_modules/@comfyorg/comfyui-electron-types');

// Function to copy files from dist to frontend
function copyTypesToFrontend() {
  try {
    // Check if target directory exists
    if (!fs.existsSync(targetDir)) {
      console.log(`Target directory doesn't exist: ${targetDir}`);
      console.log('Please ensure ComfyUI_frontend is installed with dependencies');
      return false;
    }

    // Copy all files from dist to target
    const files = fs.readdirSync(distDir);
    for (const file of files) {
      const sourcePath = path.join(distDir, file);
      const targetPath = path.join(targetDir, file);

      // Copy file
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`Copied ${file} to frontend`);
    }

    console.log('✅ Types successfully copied to ComfyUI_frontend');
    return true;
  } catch (error) {
    console.error('Error copying types:', error);
    return false;
  }
}

// Function to build types once
function buildTypes() {
  return new Promise((resolve, reject) => {
    console.log('Building types...');
    const build = spawn('yarn', ['vite:types'], {
      cwd: rootDir,
      shell: true,
      stdio: 'inherit',
    });

    build.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Types built successfully');
        resolve();
      } else {
        reject(new Error(`Build failed with code ${code}`));
      }
    });

    build.on('error', (err) => {
      reject(err);
    });
  });
}

// Main function for watch mode
async function watchTypes() {
  console.log('Starting types watch mode...');
  console.log(`Watching for changes and copying to: ${targetDir}`);

  // Initial build and copy
  try {
    await buildTypes();
    copyTypesToFrontend();
  } catch (error) {
    console.error('Initial build failed:', error);
    process.exit(1);
  }

  // Start vite in watch mode with types config
  const viteWatch = spawn('yarn', ['vite', 'build', '--watch', '--config', 'vite.types.config.ts'], {
    cwd: rootDir,
    shell: true,
    stdio: 'pipe',
  });

  // Handle vite output
  viteWatch.stdout.on('data', (data) => {
    const output = Buffer.isBuffer(data) ? data.toString() : String(data);
    process.stdout.write(output);

    // When build completes, copy files
    if (output.includes('built in')) {
      console.log('Build completed, copying types to frontend...');

      // Run prepareTypes.js to update package.json
      const prepare = spawn('node', ['scripts/prepareTypes.js'], {
        cwd: rootDir,
        shell: true,
        stdio: 'inherit',
      });

      prepare.on('close', () => {
        copyTypesToFrontend();
      });
    }
  });

  viteWatch.stderr.on('data', (data) => {
    const error = Buffer.isBuffer(data) ? data.toString() : String(data);
    process.stderr.write(error);
  });

  viteWatch.on('close', (code) => {
    console.log(`Vite watch process exited with code ${code}`);
    process.exit(code);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nStopping watch mode...');
    viteWatch.kill('SIGTERM');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    viteWatch.kill('SIGTERM');
    process.exit(0);
  });
}

// Main execution
// Check if we're in watch mode or build-once mode
const isWatchMode = process.argv.includes('--watch') || process.argv.includes('-w');

if (isWatchMode) {
  await watchTypes();
} else {
  // One-time build and copy
  try {
    await buildTypes();
    copyTypesToFrontend();
    process.exit(0);
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}
