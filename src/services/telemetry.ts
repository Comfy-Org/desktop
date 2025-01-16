import { app, ipcMain } from 'electron';
import log from 'electron-log/main';
import mixpanel, { PropertyDict } from 'mixpanel';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import si from 'systeminformation';

import { IPC_CHANNELS } from '../constants';
import { InstallOptions } from '../preload';

let instance: ITelemetry | null = null;
export interface ITelemetry {
  hasConsent: boolean;
  track(eventName: string, properties?: PropertyDict): void;
  flush(): void;
  registerHandlers(): void;
}

interface GpuInfo {
  model: string;
  vendor: string;
  vram: number | null;
}

const MIXPANEL_TOKEN = '6a7f9f6ae2084b4e7ff7ced98a6b5988';
export class MixpanelTelemetry {
  public hasConsent: boolean = false;
  private distinctId: string;
  private readonly storageFile: string;
  private queue: { eventName: string; properties: PropertyDict }[] = [];
  private mixpanelClient: mixpanel.Mixpanel;
  private cachedGpuInfo: GpuInfo[] | null = null;
  constructor(mixpanelClass: mixpanel.Mixpanel) {
    this.mixpanelClient = mixpanelClass.init(MIXPANEL_TOKEN, {
      geolocate: true,
    });
    // Store the distinct ID in a file in the user data directory for easy access.
    this.storageFile = path.join(app.getPath('userData'), 'telemetry.txt');
    this.distinctId = this.getOrCreateDistinctId(this.storageFile);
    this.queue = [];
    ipcMain.once(IPC_CHANNELS.INSTALL_COMFYUI, (_event, installOptions: InstallOptions) => {
      if (installOptions.allowMetrics) {
        this.hasConsent = true;
      }
    });
  }

  private getOrCreateDistinctId(filePath: string): string {
    try {
      // Try to read existing ID
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
      // Generate new ID if none exists
      const newId = randomUUID();
      fs.writeFileSync(filePath, newId);
      return newId;
    } catch (error) {
      log.error('Failed to manage distinct ID:', error);
      return '';
    }
  }

  /**
   * Track an event. If consent is not given, the event is queued for later.
   * @param eventName
   * @param properties
   */
  track(eventName: string, properties?: PropertyDict): void {
    const defaultProperties = {
      distinct_id: this.distinctId,
      time: new Date(),
      $os: os.platform(),
    };

    if (!this.hasConsent) {
      log.debug(`Queueing event ${eventName} with properties ${JSON.stringify(properties)}`);
      this.queue.push({
        eventName,
        properties: {
          ...defaultProperties,
          ...properties,
        },
      });
      return;
    }

    this.flush();

    try {
      const enrichedProperties = {
        ...defaultProperties,
        ...properties,
      };
      this.mixpanelTrack(eventName, enrichedProperties);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.identify();
    } catch (error) {
      log.error('Failed to track event:', error);
    }
  }

  /**
   * Empty the queue and send all events to Mixpanel.
   */
  flush(): void {
    while (this.queue.length > 0) {
      const { eventName, properties } = this.queue.pop()!;
      this.mixpanelTrack(eventName, properties);
    }
  }

  registerHandlers(): void {
    ipcMain.on(IPC_CHANNELS.TRACK_EVENT, (event, eventName: string, properties?: PropertyDict) => {
      this.track(eventName, properties);
    });
  }

  private async identify(): Promise<void> {
    try {
      if (!this.cachedGpuInfo) {
        const gpuData = await si.graphics();
        this.cachedGpuInfo = gpuData.controllers.map((gpu) => ({
          model: gpu.model,
          vendor: gpu.vendor,
          vram: gpu.vram,
        }));
      }

      this.mixpanelClient.people.set(this.distinctId, {
        platform: process.platform,
        arch: os.arch(),
        gpus: this.cachedGpuInfo,
        app_version: app.getVersion(),
      });
    } catch (error) {
      log.error('Failed to get GPU information:', error);
      this.mixpanelClient.people.set(this.distinctId, {
        platform: process.platform,
        arch: os.arch(),
      });
    }
  }

  private mixpanelTrack(eventName: string, properties: PropertyDict): void {
    if (app.isPackaged) {
      log.info(`Tracking ${eventName} with properties ${JSON.stringify(properties)}`);
      this.mixpanelClient.track(eventName, properties);
    } else {
      log.info(`Would have tracked ${eventName} with properties ${JSON.stringify(properties)}`);
    }
  }
}

// Export a singleton instance
export function getTelemetry(): ITelemetry {
  if (!instance) {
    instance = new MixpanelTelemetry(mixpanel);
  }
  return instance;
}

// Classes that use the trackEvent decorator must implement this interface.
export interface HasTelemetry {
  telemetry: ITelemetry;
}

/**
 * Decorator to track the start, error, and end of a function.
 * @param eventName
 * @returns
 */
export function trackEvent(eventName: string) {
  return function <T extends HasTelemetry>(target: T, propertyKey: string, descriptor: PropertyDescriptor) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const originalMethod = descriptor.value;

    // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-explicit-any
    descriptor.value = async function (this: T, ...args: any[]) {
      this.telemetry.track(`${eventName}_start`);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return (
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        originalMethod
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          .apply(this, args)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          .then(() => {
            this.telemetry.track(`${eventName}_end`);
          })
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
          .catch((error: any) => {
            this.telemetry.track(`${eventName}_error`, {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
              error_message: error.message,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
              error_name: error.name,
            });
            throw error;
          })
      );
    };

    return descriptor;
  };
}
