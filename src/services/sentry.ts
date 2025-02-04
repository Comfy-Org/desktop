import * as Sentry from '@sentry/electron/main';
import { app, dialog } from 'electron';
import log from 'electron-log/main';
import { graphics } from 'systeminformation';

import { SENTRY_URL_ENDPOINT } from '../constants';
import { getTelemetry } from './telemetry';

const createSentryUrl = (eventId: string) => `https://comfy-org.sentry.io/projects/4508007940685824/events/${eventId}/`;

const queueMixPanelEvents = (event: Sentry.Event) => {
  const mixpanel = getTelemetry();

  while (mixpanel.hasPendingSentryEvents()) {
    const { eventName, properties } = mixpanel.popSentryEvent()!;
    mixpanel.track(eventName, {
      sentry_url: createSentryUrl(event.event_id!),
      ...properties,
    });
  }
};

class SentryLogging {
  /** Used to redact the base path in the event payload. */
  getBasePath?: () => string | undefined;
  /** If `true`, the event will be sent to Mixpanel. */
  shouldSendStatistics?: () => boolean;

  init() {
    Sentry.init({
      dsn: SENTRY_URL_ENDPOINT,
      autoSessionTracking: false,
      enabled: process.env.SENTRY_ENABLED === 'true' || app.isPackaged,
      normalizeDepth: 4,
      beforeSend: async (event) => {
        this.filterEvent(event);

        if (this.shouldSendStatistics?.()) {
          queueMixPanelEvents(event);
          return event;
        }

        getTelemetry().clearSentryQueue();

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
