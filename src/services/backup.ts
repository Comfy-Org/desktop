import * as path from 'path';
import * as fs from 'fs';
import * as glob from 'glob';
import { app } from 'electron';
import { VirtualEnvironment } from '../virtualEnvironment';
import { getAppResourcesPath } from '../install/resourcePaths';

function parseLogFile(logPath: string): Set<string> {
  const customNodes = new Set<string>();
  const pattern = /custom_nodes[/\\]([^/\\\s]+)(?:\.py)?/g;

  const content = fs.readFileSync(logPath, 'utf-8');
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const nodeName = match[1];
    // Exclude specific nodes
    if (nodeName !== 'ComfyUI-Manager' && nodeName !== 'websocket_image_save.py') {
      customNodes.add(nodeName);
    }
  }

  return customNodes;
}

function getSortedLogFiles(): string[] {
  try {
    const logsDir = app.getPath('logs');
    const logFiles = glob.sync(path.join(logsDir, 'comfyui*.log'));

    // Sort files by modification time, newest first
    return logFiles.sort((a, b) => {
      return fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime();
    });
  } catch (error) {
    console.error('Failed to get logs directory:', error);
    return [];
  }
}

async function installCustomNodes(nodes: string[], virtualEnvironment: VirtualEnvironment): Promise<void> {
  if (nodes.length === 0) {
    console.log('No custom nodes to restore');
    return;
  }
  const cmCliPath = path.join(getAppResourcesPath(), 'ComfyUI', 'custom_nodes', 'ComfyUI-Manager', 'cm-cli.py');
  console.log('Restoring custom nodes:', nodes);
  const cmd = [
    cmCliPath,
    'install',
    nodes.join(' '),
    '--install-path',
    path.join(virtualEnvironment.venvRootPath, 'custom_nodes'),
  ];
  const { exitCode } = await virtualEnvironment.runPythonCommandAsync(cmd, {
    onStdout: (data) => {
      console.log(data.toString());
    },
    onStderr: (data) => {
      console.error(data.toString());
    },
  });
  if (exitCode !== 0) {
    console.error(`Failed to install custom nodes: ${exitCode}`);
  }
}

export async function restoreCustomNodes(virtualEnvironment: VirtualEnvironment): Promise<void> {
  const logFiles = getSortedLogFiles();
  if (logFiles.length === 0) {
    console.log('No log files found');
    return;
  }

  const customNodes = new Set<string>();
  for (const logFile of logFiles) {
    const nodes = parseLogFile(logFile);
    nodes.forEach((node) => customNodes.add(node));
  }

  console.log('Found custom nodes:', customNodes);
  await installCustomNodes(Array.from(customNodes), virtualEnvironment);
}
