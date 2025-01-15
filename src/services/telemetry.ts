import mixpanel, { PropertyDict } from 'mixpanel';
import { randomUUID } from 'crypto';
import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log/main';
import { IPC_CHANNELS } from '../constants';
import { InstallOptions } from '../preload';
import * as os from 'os';
import si from 'systeminformation';
let instance: ITelemetry | null = null;
export interface ITelemetry {
  hasConsent: boolean;
  track(eventName: string, properties?: PropertyDict): void;
  flush(): void;
  registerHandlers(): void;
}

const MIXPANEL_TOKEN = '246a5311a264a5d3bc99835b28d564c5';
export class MixpanelTelemetry {
  public hasConsent: boolean = false;
  private distinctId: string;
  private readonly storageFile: string;
  private queue: { eventName: string; properties: PropertyDict }[] = [];
  private mixpanelClient: mixpanel.Mixpanel;
  constructor(mixpanelClass: mixpanel.Mixpanel) {
    this.mixpanelClient = mixpanelClass.init(MIXPANEL_TOKEN, {
      geolocate: true,
    });
    // Store the distinct ID in a file in the user data directory for easy access.
    this.storageFile = path.join(app.getPath('userData'), 'telemetry.txt');
    this.distinctId = this.getOrCreateDistinctId(this.storageFile);
    this.queue = [];
    ipcMain.once(IPC_CHANNELS.INSTALL_COMFYUI, (_event, installOptions: InstallOptions) => {
      log.verbose('Received INSTALL_COMFYUI.');
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
      return randomUUID(); // Fallback to temporary ID
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
      const gpuData = await si.graphics();
      const gpus = gpuData.controllers.map((gpu) => ({
        model: gpu.model,
        vendor: gpu.vendor,
        vram: gpu.vram,
      }));

      this.mixpanelClient.people.set(this.distinctId, {
        platform: process.platform,
        arch: os.arch(),
        gpus: gpus,
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
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: T, ...args: any[]) {
      this.telemetry.track(`${eventName}_start`);

      return originalMethod
        .apply(this, args)
        .then(() => {
          this.telemetry.track(`${eventName}_end`);
        })
        .catch((error: any) => {
          this.telemetry.track(`${eventName}_error`, {
            error_message: error.message,
            error_name: error.name,
          });
          throw error;
        });
    };

    return descriptor;
  };
}
