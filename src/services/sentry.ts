import * as Sentry from '@sentry/electron/main';
import { app, dialog } from 'electron';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';
import { graphics } from 'systeminformation';

import { useComfySettings } from '@/config/comfySettings';

import { COMFYUI_LOG_FILENAME, MAIN_LOG_FILENAME, SENTRY_URL_ENDPOINT } from '../constants';

const NUM_LOG_LINES_CAPTURED = 64;
const SENTRY_PROJECT_ID = '4508007940685824';

const createSentryUrl = (eventId: string) =>
  `https://comfy-org.sentry.io/projects/${SENTRY_PROJECT_ID}/events/${eventId}/`;

const stripLogMetadata = (line: string): string =>
  // Remove timestamp and log level pattern like [2024-03-14 10:15:30.123] [info]
  line.replace(/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}]\s+\[\w+]\s+/, '');

const getLogTail = (numLines: number, logFilename: string): string => {
  try {
    const logPath = path.join(app.getPath('logs'), logFilename);
    if (!fs.existsSync(logPath)) return `Log file not found at path: ${logPath}`;
    const content = fs.readFileSync(logPath, 'utf8');
    return content
      .split('\n')
      .filter(Boolean) // remove empty lines
      .slice(-numLines)
      .map((line) => stripLogMetadata(line))
      .join('\n');
  } catch (error) {
    log.error('Error reading log file:', error);
    return '';
  }
};

/**
 * Capture a Sentry exception and return the Sentry URL for the captured event.
 * @param error The error to capture
 * @param eventName The name to tag the captured Sentry event with
 * @returns The Sentry URL for the captured event
 */
export function captureSentryException(error: unknown, eventName: string) {
  const settings = useComfySettings();
  const eventId = Sentry.captureException(error, {
    tags: {
      environment: process.env.NODE_ENV,
      comfyUIVersion: __COMFYUI_VERSION__,
      pythonMirror: settings.get('Comfy-Desktop.UV.PythonInstallMirror'),
      pypiMirror: settings.get('Comfy-Desktop.UV.PypiInstallMirror'),
      torchMirror: settings.get('Comfy-Desktop.UV.TorchInstallMirror'),
      eventName,
    },
    extra: {
      logs: getLogTail(NUM_LOG_LINES_CAPTURED, MAIN_LOG_FILENAME),
      comfyLogs: getLogTail(NUM_LOG_LINES_CAPTURED, COMFYUI_LOG_FILENAME),
    },
  });
  return createSentryUrl(eventId);
}

class SentryLogging {
  /** Used to redact the base path in the event payload. */
  getBasePath?: () => string | undefined;

  init() {
    Sentry.init({
      dsn: SENTRY_URL_ENDPOINT,
      autoSessionTracking: false,
      enabled: process.env.SENTRY_ENABLED === 'true' || app.isPackaged,
      normalizeDepth: 4,
      beforeSend: async (event) => {
        this.filterEvent(event);

        if (useComfySettings().get('Comfy-Desktop.SendStatistics')) {
          return event;
        }

        const errorMessage = event.exception?.values?.[0]?.value || 'Unknown error';
        const errorType = event.exception?.values?.[0]?.type || 'Error';

        const { response } = await dialog.showMessageBox({
          title: 'Send Crash Report',
          message: `An error occurred: ${errorType}`,
          detail: `${errorMessage}\n\nWould you like to send the crash to the team?`,
          buttons: ['Send Report', 'Do not send crash report'],
          type: 'error',
        });

        return response === 0 ? event : null;
      },
      integrations: [
        Sentry.childProcessIntegration({
          breadcrumbs: ['abnormal-exit', 'killed', 'crashed', 'launch-failed', 'oom', 'integrity-failure'],
          events: ['abnormal-exit', 'killed', 'crashed', 'launch-failed', 'oom', 'integrity-failure'],
        }),
      ],
    });
  }

  async setSentryGpuContext(): Promise<void> {
    log.debug('Setting up GPU context');
    try {
      const graphicsInfo = await graphics();
      const gpuInfo = graphicsInfo.controllers.map((gpu, index) => ({
        [`gpu_${index}`]: {
          vendor: gpu.vendor,
          model: gpu.model,
          vram: gpu.vram,
          driver: gpu.driverVersion,
        },
      }));

      // Combine all GPU info into a single object
      const allGpuInfo = { ...gpuInfo };
      // Set Sentry context with all GPU information
      Sentry.setContext('gpus', allGpuInfo);
    } catch (error) {
      log.error('Error getting GPU info:', error);
    }
  }

  private filterEvent(obj: unknown) {
    const basePath = this.getBasePath?.();
    if (!obj || !basePath) return obj;

    if (typeof obj === 'string') {
      return obj.replaceAll(basePath, '[basePath]');
    }

    try {
      if (typeof obj === 'object') {
        for (const k in obj) {
          try {
            const record = obj as Record<string, unknown>;
            record[k] = this.filterEvent(record[k]);
          } catch {
            // Failed to read/write key
          }
        }
      }
    } catch {
      // Failed to enumerate keys
    }

    return obj;
  }
}

export default new SentryLogging();
