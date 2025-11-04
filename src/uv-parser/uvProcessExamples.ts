/**
 * Example of using UvProcess to replace node-pty implementation
 *
 * Key features demonstrated:
 * 1. Using factory functions to create UV processes
 * 2. Setting up event listeners for real-time progress
 * 3. Handling async execution with proper error handling
 */
import type { PackageInfo } from './types';
import { UvProcess, createCacheCleanProcess, createPipInstallProcess, createVenvProcess } from './uvProcess';

// Example 1: Simple pip install with packages
async function installPackages() {
  const process = createPipInstallProcess('/path/to/uv', {
    packages: ['numpy', 'pandas'],
    indexUrl: 'https://pypi.org/simple',
    verbose: true,
  });

  // Listen to events
  process.on('stage-change', (stage) => console.log('Stage:', stage));
  process.on('package-installed', (pkg: PackageInfo) => console.log('Installed:', pkg.name, pkg.version));
  process.on('error', (error) => console.error('Error:', error));

  // Execute and wait for completion
  const result = await process.execute();
  console.log('Success:', result.success);
  console.log('Exit code:', result.exitCode);
}

// Example 2: Install from requirements file with progress tracking
async function installRequirements() {
  const process = createPipInstallProcess('/path/to/uv', {
    requirementsFile: '/path/to/requirements.txt',
    upgrade: true,
    verbose: true,
  });

  // Track download progress
  let downloadCount = 0;
  let totalDownloads = 0;

  process.on('download-progress', (progress: { state: string }) => {
    if (progress.state === 'started') totalDownloads++;
    if (progress.state === 'completed') {
      downloadCount++;
      console.log(`Downloads: ${downloadCount}/${totalDownloads}`);
    }
  });

  // Track installed packages
  const installedPackages: PackageInfo[] = [];
  process.on('package-installed', (pkg: PackageInfo) => {
    installedPackages.push(pkg);
  });

  const result = await process.execute();
  return { result, installedPackages };
}

// Example 3: Create virtual environment
async function createVirtualEnv() {
  const process = createVenvProcess('/path/to/uv', {
    path: '/project/venv',
    python: '3.11',
    pythonPreference: 'only-managed',
  });

  process.on('stdout', (line: string) => console.log(line));

  const result = await process.execute();
  if (!result.success) {
    throw new Error(`Failed to create venv: exit code ${result.exitCode}`);
  }
}

// Example 4: Clean UV cache
async function cleanCache() {
  const process = createCacheCleanProcess('/path/to/uv', {
    verbose: true,
  });

  const result = await process.execute();
  console.log('Cache cleaned:', result.success);
}

// Example 5: Manual process creation with custom args
async function customUVCommand() {
  const process = new UvProcess({
    uvPath: '/path/to/uv',
    command: 'pip',
    args: ['show', 'numpy'],
    timeout: 30_000,
    captureRawOutput: true,
  });

  const result = await process.execute();

  // Access captured output
  if (result.rawStdout) {
    console.log('Package info:', result.rawStdout);
  }

  return result;
}

export { installPackages, installRequirements, createVirtualEnv, cleanCache, customUVCommand };
