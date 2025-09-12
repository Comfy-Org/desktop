import log from 'electron-log/main';

import { IPC_CHANNELS } from '@/constants';
import type { AppWindow } from '@/main-process/appWindow';
import type { ProcessCallbacks } from '@/virtualEnvironment';

/**
 * Creates process callbacks for handling stdout and stderr output
 * @param appWindow The application window to send messages to
 * @param options Optional configuration for the callbacks
 * @return Process callbacks for virtual terminal output
 */
export function createProcessCallbacks(
  appWindow: AppWindow,
  options?: { logStderrAsInfo?: boolean }
): ProcessCallbacks {
  const onStdout = (data: string) => {
    log.info(data);
    appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
  };

  if (options?.logStderrAsInfo) {
    return { onStdout, onStderr: onStdout };
  }

  const onStderr = (data: string) => {
    log.error(data);
    appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
  };

  return { onStdout, onStderr };
}
