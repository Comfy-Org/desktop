import path from 'node:path';
import fs from 'node:fs';
import glob from 'glob';
import { app } from 'electron';
import { VirtualEnvironment } from '../virtualEnvironment';
import { getAppResourcesPath } from '../install/resourcePaths';
import log from 'electron-log/main';
import { AppWindow } from '../main-process/appWindow';
import { IPC_CHANNELS } from '../constants';
import { ansiCodes } from '../utils';

function parseLogFile(logPath: string): Set<string> {
  console.log('Parsing log file:', logPath);
  const customNodes = new Set<string>();
  const content = fs.readFileSync(logPath, 'utf8');

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Match the exact format from Python's "{:6.1f} seconds"
    const timeMatch = line.match(/\s*\d+\.\d+\s+seconds/);
    if (timeMatch) {
      log.info(line);
      // Second pattern: extract custom node name from path
      const customNodeMatch = line.match(/custom_nodes[/\\]([^/\\]+)/);
      if (customNodeMatch) {
        log.info('Node match found:', customNodeMatch[1]);
        const nodeName = customNodeMatch[1];
        if (nodeName !== 'ComfyUI-Manager' && nodeName !== 'websocket_image_save.py') {
          customNodes.add(nodeName);
        }
      }
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

async function installCustomNodes(
  nodes: string[],
  virtualEnvironment: VirtualEnvironment,
  appWindow: AppWindow
): Promise<void> {
  if (nodes.length === 0) {
    return;
  }
  const cmCliPath = path.join(getAppResourcesPath(), 'ComfyUI', 'custom_nodes', 'ComfyUI-Manager', 'cm-cli.py');
  appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `Reinstalling ${nodes.length} custom nodes...\n`);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `Installing custom node (${i + 1}/${nodes.length}): ${node}\n`);
    const cmd = [
      cmCliPath,
      'install',
      node,
      '--install-path',
      path.join(virtualEnvironment.venvRootPath, 'custom_nodes'),
      '--no-deps',
    ];
    const { exitCode } = await virtualEnvironment.runPythonCommandAsync(cmd, {
      onStdout: (data) => log.info(data.toString().replaceAll(ansiCodes, '')),
      onStderr: (data) => log.error(data.toString().replaceAll(ansiCodes, '')),
    });
    if (exitCode !== 0) {
      log.error(`Failed to install custom nodes: ${exitCode}`);
    }
    log.info(`Successfully installed custom node: ${node}`);
  }
}

export async function restoreCustomNodes(virtualEnvironment: VirtualEnvironment, appWindow: AppWindow): Promise<void> {
  const logFiles = getSortedLogFiles();
  if (logFiles.length === 0) {
    return;
  }

  const customNodes = new Set<string>();
  for (const logFile of logFiles) {
    const nodes = parseLogFile(logFile);
    nodes.forEach((node) => customNodes.add(node));
  }

  log.info('Found custom nodes:', customNodes);
  await installCustomNodes(Array.from(customNodes), virtualEnvironment, appWindow);
}
